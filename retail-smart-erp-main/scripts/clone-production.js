const { Client } = require('pg');

async function run() {
  const prod = new Client({
    connectionString: 'postgresql://postgres:GscoHkXwSOTswMQdTxxUFjanduCKHaDV@gondola.proxy.rlwy.net:31245/railway',
    ssl: { rejectUnauthorized: false }
  });

  const local = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/retail_smart_pos'
  });

  await prod.connect();
  await local.connect();
  console.log('Connected to both databases.');

  // Get all tables
  const tablesRes = await prod.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  const tables = tablesRes.rows.map(r => r.tablename);
  console.log(`Found ${tables.length} tables.`);

  // Step 1: Drop all local tables
  console.log('\nStep 1: Dropping local tables...');
  await local.query('SET session_replication_role = replica;');
  for (const table of tables) {
    try {
      await local.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    } catch(e) {}
  }
  // Also drop any tables that exist locally but not in prod
  const localTablesRes = await local.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);
  for (const row of localTablesRes.rows) {
    try {
      await local.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
    } catch(e) {}
  }
  await local.query('SET session_replication_role = DEFAULT;');
  console.log('All local tables dropped.');

  // Step 2: Recreate schema
  console.log('\nStep 2: Recreating schema from production...');

  for (const table of tables) {
    const colRes = await prod.query(`
      SELECT column_name, udt_name, character_maximum_length, column_default,
             is_nullable, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table]);

    const cols = colRes.rows.map(c => {
      let type = c.udt_name;
      if (type === 'int4') type = 'integer';
      else if (type === 'int8') type = 'bigint';
      else if (type === 'int2') type = 'smallint';
      else if (type === 'float8') type = 'double precision';
      else if (type === 'float4') type = 'real';
      else if (type === 'bool') type = 'boolean';
      else if (type === 'varchar') type = c.character_maximum_length ? `varchar(${c.character_maximum_length})` : 'text';
      else if (type === 'numeric') type = c.numeric_precision ? `numeric(${c.numeric_precision},${c.numeric_scale || 0})` : 'numeric';
      else if (type === 'timestamptz') type = 'timestamp with time zone';
      else if (type === 'timestamp') type = 'timestamp without time zone';
      else if (type === '_text') type = 'text[]';
      else if (type === '_varchar') type = 'varchar[]';
      else if (type === '_int4') type = 'integer[]';

      let def = '';
      if (c.column_default) def = ` DEFAULT ${c.column_default}`;
      let nullable = c.is_nullable === 'NO' ? ' NOT NULL' : '';

      return `"${c.column_name}" ${type}${def}${nullable}`;
    });

    try {
      await local.query(`CREATE TABLE "${table}" (${cols.join(', ')})`);
    } catch(e) {
      console.error(`  Error creating ${table}: ${e.message}`);
    }
  }
  console.log('Schema recreated.');

  // Step 3: Copy data
  console.log('\nStep 3: Copying data...');
  await local.query('SET session_replication_role = replica;');

  let copied = 0;
  for (const table of tables) {
    try {
      const countRes = await prod.query(`SELECT count(*) as c FROM "${table}"`);
      const count = parseInt(countRes.rows[0].c);

      if (count === 0) {
        copied++;
        process.stdout.write(`  [${copied}/${tables.length}] ${table}: 0 rows (skipped)\n`);
        continue;
      }

      // Fetch all rows
      const dataRes = await prod.query(`SELECT * FROM "${table}"`);

      if (dataRes.rows.length > 0) {
        const columns = Object.keys(dataRes.rows[0]);
        const colNames = columns.map(c => `"${c}"`).join(', ');

        // Insert in batches
        const batchSize = 50;
        for (let i = 0; i < dataRes.rows.length; i += batchSize) {
          const batch = dataRes.rows.slice(i, i + batchSize);
          const values = [];
          const placeholders = [];
          let paramIdx = 1;

          for (const row of batch) {
            const rowPlaceholders = [];
            for (const col of columns) {
              values.push(row[col]);
              rowPlaceholders.push(`$${paramIdx}`);
              paramIdx++;
            }
            placeholders.push(`(${rowPlaceholders.join(', ')})`);
          }

          await local.query(
            `INSERT INTO "${table}" (${colNames}) VALUES ${placeholders.join(', ')}`,
            values
          );
        }
      }

      copied++;
      process.stdout.write(`  [${copied}/${tables.length}] ${table}: ${count} rows\n`);
    } catch(e) {
      copied++;
      console.error(`  [${copied}/${tables.length}] ERROR ${table}: ${e.message.substring(0, 120)}`);
    }
  }

  await local.query('SET session_replication_role = DEFAULT;');

  // Step 4: Reset sequences
  console.log('\nStep 4: Resetting sequences...');
  for (const table of tables) {
    try {
      const seqCheck = await prod.query(`
        SELECT column_name, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        AND column_default LIKE 'nextval%'
      `, [table]);

      for (const seq of seqCheck.rows) {
        const maxRes = await local.query(`SELECT COALESCE(MAX("${seq.column_name}"), 0) + 1 as next_val FROM "${table}"`);
        const seqMatch = seq.column_default.match(/nextval\('([^']+)'/);
        if (seqMatch) {
          try {
            await local.query(`SELECT setval('${seqMatch[1]}', ${maxRes.rows[0].next_val}, false)`);
          } catch(e) {
            // Sequence might not exist, create it
            try {
              await local.query(`CREATE SEQUENCE IF NOT EXISTS "${seqMatch[1]}"`);
              await local.query(`SELECT setval('${seqMatch[1]}', ${maxRes.rows[0].next_val}, false)`);
            } catch(e2) {}
          }
        }
      }
    } catch(e) {}
  }
  console.log('Sequences reset.');

  // Step 5: Recreate primary keys
  console.log('\nStep 5: Recreating primary keys...');
  const pkRes = await prod.query(`
    SELECT tc.table_name, tc.constraint_name,
           string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
    GROUP BY tc.table_name, tc.constraint_name
  `);

  for (const pk of pkRes.rows) {
    try {
      const cols = pk.columns.split(', ').map(c => `"${c.trim()}"`).join(', ');
      await local.query(`ALTER TABLE "${pk.table_name}" ADD PRIMARY KEY (${cols})`);
    } catch(e) {
      console.error(`  PK error ${pk.table_name}: ${e.message.substring(0, 80)}`);
    }
  }
  console.log('Primary keys created.');

  // Step 6: Recreate indexes
  console.log('\nStep 6: Recreating indexes...');
  const idxRes = await prod.query(`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexname NOT LIKE '%pkey%'
    ORDER BY tablename
  `);

  let idxCount = 0;
  for (const idx of idxRes.rows) {
    try {
      let sql = idx.indexdef;
      // Add IF NOT EXISTS
      sql = sql.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS');
      sql = sql.replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS');
      await local.query(sql);
      idxCount++;
    } catch(e) {}
  }
  console.log(`${idxCount} indexes created.`);

  // Step 7: Recreate foreign keys
  console.log('\nStep 7: Recreating foreign keys...');
  const fkRes = await prod.query(`
    SELECT
      tc.table_name,
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);

  let fkCount = 0;
  for (const fk of fkRes.rows) {
    try {
      let sql = `ALTER TABLE "${fk.table_name}" ADD CONSTRAINT "${fk.constraint_name}"
        FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table_name}" ("${fk.foreign_column_name}")`;
      if (fk.update_rule && fk.update_rule !== 'NO ACTION') sql += ` ON UPDATE ${fk.update_rule}`;
      if (fk.delete_rule && fk.delete_rule !== 'NO ACTION') sql += ` ON DELETE ${fk.delete_rule}`;
      await local.query(sql);
      fkCount++;
    } catch(e) {}
  }
  console.log(`${fkCount} foreign keys created.`);

  console.log('\n=== DONE! Production data cloned to local database. ===');

  await prod.end();
  await local.end();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
