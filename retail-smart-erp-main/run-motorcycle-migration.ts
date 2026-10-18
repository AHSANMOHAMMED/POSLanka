import 'dotenv/config'
import { db } from './src/lib/db'
import { vehicleMakes, vehicleModels } from './src/lib/db/schema'
import { eq } from 'drizzle-orm'

interface MakeData {
  name: string
  country: string
  models: string[]
}

const sriLankaMotorcycles: MakeData[] = [
  // Japanese Brands (Most Popular)
  {
    name: 'Honda',
    country: 'Japan',
    models: [
      // Motorcycles
      'CD 125', 'CD 110', 'CB Hornet 160R', 'CB Hornet 200R', 'CB Shine', 'CB Shine SP',
      'CB Unicorn', 'CB Unicorn 160', 'CB 350', 'CB 500F', 'CB 500X', 'CB 650R',
      'CBR 150R', 'CBR 250R', 'CBR 500R', 'CBR 650R', 'CBR 1000RR',
      'CRF 250L', 'CRF 300L', 'CRF 450', 'XR 150L', 'XL 125',
      'Livo', 'Dream', 'SP 125', 'H\'ness CB350', 'Hunk', 'Twister',
      // Scooters
      'Activa', 'Activa 125', 'Activa 6G', 'Dio', 'Dio 125', 'Grazia', 'Grazia 125',
      'Aviator', 'PCX', 'PCX 125', 'PCX 160', 'Forza 350', 'ADV 150', 'ADV 350',
      'Lead', 'Scoopy', 'Zoomer', 'Moove', 'Click', 'Click 125i', 'Click 150i',
      // Cubs/Underbone
      'Super Cub', 'Super Cub 125', 'Wave', 'Wave 110', 'Wave 125', 'Dream 110',
      'CT 125', 'C125', 'Monkey', 'Grom', 'MSX 125', 'Navi',
      // Commercial
      'MD', 'MD 90', 'MD 125'
    ]
  },
  {
    name: 'Yamaha',
    country: 'Japan',
    models: [
      // Motorcycles
      'FZ', 'FZ-S', 'FZ-S FI', 'FZ-S FI V3', 'FZ-S FI V4', 'FZ 25', 'FZS 25',
      'FZ-X', 'MT-15', 'MT-15 V2', 'MT-25', 'MT-03', 'MT-07', 'MT-09', 'MT-10',
      'R15', 'R15 V3', 'R15 V4', 'R15M', 'R3', 'R6', 'R7', 'R1', 'R1M',
      'YZF-R125', 'YZF-R15', 'XSR 155', 'XSR 700', 'XSR 900',
      'Fazer', 'Fazer 25', 'Fazer FI', 'SZ', 'SZ-R', 'SZ-RR', 'Saluto',
      'XTZ 125', 'WR 155R', 'Tenere 700', 'Super Tenere',
      // Scooters
      'Ray ZR', 'Ray ZR 125', 'Ray ZR Street Rally', 'Fascino', 'Fascino 125',
      'Cygnus', 'Cygnus Ray ZR', 'NMAX', 'NMAX 155', 'XMAX', 'XMAX 300',
      'Aerox', 'Aerox 155', 'TMAX', 'Freego', 'Grand Filano', 'Fazzio', 'Lexi',
      'Mio', 'Mio i125', 'Mio Gravis', 'Mio Sporty', 'Fino', 'Ego',
      // Underbone
      'Lagenda', 'Jupiter', 'Jupiter Z', 'Spark', 'Vega', 'Crypton', 'Sirius',
      'Sniper', 'Exciter', 'Y15ZR', 'LC135'
    ]
  },
  {
    name: 'Suzuki',
    country: 'Japan',
    models: [
      // Motorcycles
      'Gixxer', 'Gixxer 150', 'Gixxer 250', 'Gixxer SF', 'Gixxer SF 250',
      'GSX-R150', 'GSX-R250', 'GSX-R600', 'GSX-R750', 'GSX-R1000',
      'GSX-S150', 'GSX-S750', 'GSX-S1000', 'GSX-S1000GT',
      'Intruder', 'Intruder 150', 'Bandit', 'Bandit 150', 'Bandit 250',
      'GN 125', 'GN 125H', 'GS 125', 'GS 150', 'GD 110', 'GD 110 HU',
      'V-Strom 250', 'V-Strom 650', 'V-Strom 1050',
      'DR 200', 'DRZ 400', 'Djebel', 'RMX 250',
      'Hayabusa', 'Katana', 'SV650', 'Volty',
      // Scooters
      'Access', 'Access 125', 'Burgman', 'Burgman Street', 'Burgman 125', 'Burgman 200', 'Burgman 400',
      'Address', 'Address 110', 'Address 125', 'Avenis', 'Avenis 125',
      'Lets', 'Swish', 'Skydrive', 'Nex', 'Smash'
    ]
  },
  {
    name: 'Kawasaki',
    country: 'Japan',
    models: [
      // Motorcycles
      'Ninja 125', 'Ninja 250', 'Ninja 300', 'Ninja 400', 'Ninja 650', 'Ninja 1000',
      'Ninja ZX-4R', 'Ninja ZX-6R', 'Ninja ZX-10R', 'Ninja ZX-10RR', 'Ninja H2',
      'Z125', 'Z250', 'Z400', 'Z650', 'Z900', 'Z900RS', 'Z1000', 'Z H2',
      'Versys 650', 'Versys 1000', 'Versys-X 300',
      'KLX 150', 'KLX 230', 'KLX 250', 'KLX 300',
      'Eliminator', 'Vulcan', 'Vulcan S', 'W175', 'W800',
      'KX 65', 'KX 85', 'KX 250', 'KX 450',
      'D-Tracker', 'D-Tracker 150', 'D-Tracker 250'
    ]
  },
  // Indian Brands (Very Popular in Sri Lanka)
  {
    name: 'Bajaj',
    country: 'India',
    models: [
      // Pulsar Series
      'Pulsar 125', 'Pulsar 135', 'Pulsar 150', 'Pulsar 160', 'Pulsar 180',
      'Pulsar 200NS', 'Pulsar 220F', 'Pulsar NS160', 'Pulsar NS200', 'Pulsar NS400',
      'Pulsar RS200', 'Pulsar N150', 'Pulsar N160', 'Pulsar N250', 'Pulsar F250',
      // Discover Series
      'Discover 100', 'Discover 110', 'Discover 125', 'Discover 150',
      // Platina & CT Series
      'Platina', 'Platina 100', 'Platina 110', 'Platina 110 H',
      'CT 100', 'CT 110', 'CT 125X',
      // Avenger Series
      'Avenger Street 160', 'Avenger Street 220', 'Avenger Cruise 220',
      // Dominar
      'Dominar 250', 'Dominar 400',
      // Boxer
      'Boxer', 'Boxer 100', 'Boxer 150',
      // Scooters
      'Chetak', 'Chetak Electric'
    ]
  },
  {
    name: 'TVS',
    country: 'India',
    models: [
      // Motorcycles
      'Apache RTR 160', 'Apache RTR 160 2V', 'Apache RTR 160 4V',
      'Apache RTR 180', 'Apache RTR 200 4V', 'Apache RR 310',
      'Apache RTR 165RP', 'Apache RTR 310',
      'Raider', 'Raider 125',
      'Star City', 'Star City Plus', 'Sport',
      'Radeon', 'Max 4R', 'Victor', 'Phoenix',
      'StaRX', 'Fiero', 'Flame',
      // Scooters
      'Jupiter', 'Jupiter 125', 'Jupiter Classic',
      'Ntorq', 'Ntorq 125', 'Ntorq Race XP',
      'Scooty Pep Plus', 'Scooty Zest', 'Scooty Zest 110',
      'Wego', 'Zeppelin',
      'iQube', 'iQube Electric', 'iQube S',
      // Mopeds
      'XL 100', 'XL 100 Heavy Duty', 'XL 100 Comfort'
    ]
  },
  {
    name: 'Hero',
    country: 'India',
    models: [
      // Motorcycles
      'Splendor', 'Splendor Plus', 'Splendor iSmart', 'Super Splendor',
      'HF Deluxe', 'HF 100', 'HF Dawn',
      'Glamour', 'Glamour Xtec',
      'Passion Pro', 'Passion Plus', 'Passion Xtec',
      'Xtreme 160R', 'Xtreme 160R 4V', 'Xtreme 200R', 'Xtreme 200S',
      'Xpulse 200', 'Xpulse 200 4V', 'Xpulse 200T',
      'Hunk 150R', 'Hunk 160R', 'Hunk 160R 4V',
      'Achiever', 'Ignitor', 'Impulse', 'Karizma',
      // Scooters
      'Destini 125', 'Destini Prime',
      'Maestro', 'Maestro Edge', 'Maestro Edge 125',
      'Pleasure', 'Pleasure Plus',
      'Xoom 110', 'Dash'
    ]
  },
  {
    name: 'Royal Enfield',
    country: 'India',
    models: [
      'Classic 350', 'Classic 500', 'Classic Chrome', 'Classic Stealth',
      'Bullet 350', 'Bullet 500', 'Bullet Electra',
      'Thunderbird 350', 'Thunderbird 500', 'Thunderbird X',
      'Meteor 350', 'Hunter 350',
      'Himalayan', 'Himalayan 450',
      'Continental GT 650', 'Interceptor 650',
      'Super Meteor 650', 'Shotgun 650',
      'Scram 411', 'Guerrilla 450'
    ]
  },
  // Austrian Brand
  {
    name: 'KTM',
    country: 'Austria',
    models: [
      // Duke Series
      'Duke 125', 'Duke 200', 'Duke 250', 'Duke 390', 'Duke 690', 'Duke 790', 'Duke 890', 'Duke 1290',
      // RC Series
      'RC 125', 'RC 200', 'RC 390', 'RC 8C',
      // Adventure
      'Adventure 250', 'Adventure 390', 'Adventure 790', 'Adventure 890', 'Adventure 1290',
      // Enduro/Cross
      'EXC 150', 'EXC 250', 'EXC 300', 'EXC 350', 'EXC 450', 'EXC 500',
      'SX 125', 'SX 250', 'SX 350', 'SX 450',
      // Supermoto
      'SMC R 690', 'SMC R 890'
    ]
  },
  {
    name: 'Husqvarna',
    country: 'Sweden',
    models: [
      'Svartpilen 125', 'Svartpilen 200', 'Svartpilen 250', 'Svartpilen 401',
      'Vitpilen 125', 'Vitpilen 250', 'Vitpilen 401',
      'Norden 901',
      'FE 250', 'FE 350', 'FE 450', 'FE 501',
      'TE 150i', 'TE 250i', 'TE 300i',
      'FC 250', 'FC 350', 'FC 450'
    ]
  },
  // European Premium Brands
  {
    name: 'BMW Motorrad',
    country: 'Germany',
    models: [
      'G 310 R', 'G 310 GS',
      'F 750 GS', 'F 850 GS', 'F 900 R', 'F 900 XR',
      'R 1250 GS', 'R 1250 GS Adventure', 'R 1250 R', 'R 1250 RS', 'R 1250 RT',
      'R nineT', 'R nineT Scrambler', 'R nineT Pure', 'R nineT Urban G/S',
      'S 1000 R', 'S 1000 RR', 'S 1000 XR',
      'M 1000 R', 'M 1000 RR',
      'R 18', 'R 18 Classic', 'R 18 Transcontinental',
      'C 400 X', 'C 400 GT', 'CE 04'
    ]
  },
  {
    name: 'Ducati',
    country: 'Italy',
    models: [
      'Monster', 'Monster 821', 'Monster 937', 'Monster 1200',
      'Panigale V2', 'Panigale V4', 'Panigale V4 S', 'Panigale V4 R',
      'Streetfighter V2', 'Streetfighter V4', 'Streetfighter V4 S',
      'Multistrada V2', 'Multistrada V4', 'Multistrada V4 S',
      'Scrambler', 'Scrambler Icon', 'Scrambler Full Throttle', 'Scrambler Desert Sled',
      'Diavel', 'Diavel V4', 'XDiavel',
      'Hypermotard 950', 'DesertX'
    ]
  },
  {
    name: 'Aprilia',
    country: 'Italy',
    models: [
      'RS 125', 'RS 150', 'RS 457', 'RS 660', 'RSV4',
      'Tuono 125', 'Tuono 660', 'Tuono V4',
      'SR 125', 'SR 150', 'SR 160', 'SXR 125', 'SXR 160',
      'Storm 125', 'Tuareg 660'
    ]
  },
  {
    name: 'Vespa',
    country: 'Italy',
    models: [
      'LX 125', 'LX 150', 'VXL 125', 'VXL 150',
      'SXL 125', 'SXL 150',
      'Elegante 150', 'Notte 125',
      'Sprint', 'Sprint 125', 'Sprint 150',
      'Primavera', 'Primavera 125', 'Primavera 150',
      'GTS', 'GTS 125', 'GTS 150', 'GTS 300',
      'ZX 125', 'Racing Sixties'
    ]
  },
  {
    name: 'Piaggio',
    country: 'Italy',
    models: [
      'Liberty', 'Liberty 125', 'Liberty 150',
      'Medley', 'Medley 125', 'Medley 150',
      'Beverly', 'Beverly 300', 'Beverly 400',
      'MP3 300', 'MP3 500',
      'Ape', 'Ape Auto', 'Ape Xtra'
    ]
  },
  // Malaysian Brands
  {
    name: 'Demak',
    country: 'Malaysia',
    models: [
      'DTM', 'DTM 150', 'DTM 200',
      'DZM', 'DZM 150', 'DZM 200',
      'Rino', 'Rino 110', 'Rino 125',
      'Warrior', 'Warrior 150', 'Warrior 200',
      'Civic', 'Civic 110', 'Civic 125',
      'EVO Z', 'Eco 110', 'Trax',
      'Skyline', 'Matrix', 'Evo'
    ]
  },
  {
    name: 'SYM',
    country: 'Taiwan',
    models: [
      'VF3i', 'VF3i 185',
      'Jet 14', 'Jet 4', 'Jet S',
      'Symphony', 'Symphony ST', 'Symphony SR',
      'Fiddle', 'Fiddle III',
      'Crox', 'Crox 125', 'Crox 150',
      'Joyride', 'Joyride S', 'Maxsym',
      'Bonus', 'E-Bonus'
    ]
  },
  {
    name: 'Modenas',
    country: 'Malaysia',
    models: [
      'Kriss', 'Kriss 110', 'Kriss MR1', 'Kriss MR2',
      'CT 100', 'CT 115S',
      'Pulsar NS200', 'Pulsar RS200', 'Dominar D400',
      'Ninja 250', 'NS200',
      'Karisma', 'Elegan'
    ]
  },
  // Chinese Brands
  {
    name: 'Benelli',
    country: 'Italy/China',
    models: [
      'TNT 125', 'TNT 150', 'TNT 25', 'TNT 300', 'TNT 600',
      '302S', '302R', '502C', '752S',
      'Leoncino 250', 'Leoncino 500', 'Leoncino 800',
      'TRK 251', 'TRK 502', 'TRK 502X', 'TRK 702',
      'Imperiale 400'
    ]
  },
  {
    name: 'CFMOTO',
    country: 'China',
    models: [
      '150NK', '250NK', '250SR', '300NK', '300SR',
      '400NK', '450NK', '650NK', '650GT', '650MT',
      '700CL-X', '800MT',
      'Papio', 'SS 110', 'ST 110'
    ]
  },
  {
    name: 'Zongshen',
    country: 'China',
    models: [
      'ZS 110', 'ZS 125', 'ZS 150', 'ZS 200', 'ZS 250',
      'Cyclone', 'Cyclone RX3', 'Cyclone RE3',
      'RX1', 'RX4', 'RE3', 'RS4',
      'Piaggio', 'Ryuka'
    ]
  },
  {
    name: 'Lifan',
    country: 'China',
    models: [
      'KP 150', 'KP 200', 'KP 250', 'KP Mini',
      'KPR 150', 'KPR 200',
      'KPT 200', 'KPT 400',
      'KPV 150',
      'V16'
    ]
  },
  // Other Brands Available in Sri Lanka
  {
    name: 'Harley-Davidson',
    country: 'USA',
    models: [
      'Street 750', 'Street Rod',
      'Iron 883', 'Iron 1200', 'Forty-Eight',
      'Street Bob', 'Low Rider', 'Fat Bob', 'Fat Boy',
      'Softail Standard', 'Softail Slim', 'Heritage Classic',
      'Road King', 'Street Glide', 'Road Glide', 'Ultra Limited',
      'Pan America', 'Sportster S', 'Nightster', 'X440'
    ]
  },
  {
    name: 'Triumph',
    country: 'UK',
    models: [
      'Street Triple', 'Street Triple R', 'Street Triple RS',
      'Speed Triple 1200', 'Speed Triple 1200 RS',
      'Tiger 660 Sport', 'Tiger 850 Sport', 'Tiger 900', 'Tiger 1200',
      'Trident 660',
      'Bonneville T100', 'Bonneville T120', 'Bonneville Bobber', 'Bonneville Speedmaster',
      'Scrambler 900', 'Scrambler 1200',
      'Rocket 3',
      'Speed 400', 'Scrambler 400 X'
    ]
  }
]

async function runMigration() {
  console.log('Starting motorcycle makes/models migration...')

  try {
    // Get existing makes to check what's already there
    const existingMakes = await db.query.vehicleMakes.findMany()
    const existingMakeNames = new Set(existingMakes.map(m => m.name))

    let makesAdded = 0
    let modelsAdded = 0

    for (const makeData of sriLankaMotorcycles) {
      // Check if make already exists
      let makeId: string

      if (existingMakeNames.has(makeData.name)) {
        // Make exists, get its ID
        const existingMake = existingMakes.find(m => m.name === makeData.name)
        makeId = existingMake!.id
        console.log(`${makeData.name} already exists, adding new models...`)
      } else {
        // Insert new make
        console.log(`Adding ${makeData.name}...`)
        const [newMake] = await db.insert(vehicleMakes).values({
          name: makeData.name,
          country: makeData.country,
          isActive: true
        }).returning()
        makeId = newMake.id
        makesAdded++
      }

      // Get existing models for this make
      const existingModels = await db.query.vehicleModels.findMany({
        where: eq(vehicleModels.makeId, makeId)
      })
      const existingModelNames = new Set(existingModels.map(m => m.name))

      // Insert only new models
      for (const modelName of makeData.models) {
        if (!existingModelNames.has(modelName)) {
          await db.insert(vehicleModels).values({
            makeId: makeId,
            name: modelName,
            isActive: true
          })
          modelsAdded++
        }
      }
    }

    console.log('Migration completed successfully!')
    console.log(`Added ${makesAdded} new makes and ${modelsAdded} new models.`)

  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  }

  process.exit(0)
}

runMigration()
