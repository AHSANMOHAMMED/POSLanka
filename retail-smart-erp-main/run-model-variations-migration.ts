import 'dotenv/config'
import { db } from './src/lib/db'
import { vehicleMakes, vehicleModels } from './src/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// Comprehensive model variations with codes
const modelVariations = {
  // BAJAJ - Complete model variations
  'Bajaj': [
    // Pulsar Series - All Variants
    'Pulsar 125', 'Pulsar 125 Drum', 'Pulsar 125 Disc', 'Pulsar 125 Split Seat',
    'Pulsar N125', 'Pulsar NS125',
    'Pulsar 135', 'Pulsar 135 LS',
    'Pulsar 150', 'Pulsar 150 Classic', 'Pulsar 150 DTS-i', 'Pulsar 150 Twin Disc',
    'Pulsar N150', 'Pulsar NS150',
    'Pulsar 160', 'Pulsar N160', 'Pulsar NS160', 'Pulsar NS160 FI',
    'Pulsar 180', 'Pulsar 180 DTS-i', 'Pulsar 180F', 'Pulsar 180 Neon',
    'Pulsar 200', 'Pulsar NS200', 'Pulsar NS200 FI', 'Pulsar RS200', 'Pulsar RS200 ABS',
    'Pulsar AS200', 'Pulsar 200NS',
    'Pulsar 220', 'Pulsar 220F', 'Pulsar 220 DTS-i', 'Pulsar 220S', 'Pulsar 220 DTS-Fi',
    'Pulsar N250', 'Pulsar F250', 'Pulsar NS250',
    'Pulsar NS400', 'Pulsar NS400Z',

    // Discover Series - All Variants
    'Discover 100', 'Discover 100M', 'Discover 100T',
    'Discover 110', 'Discover 110 CBS',
    'Discover 125', 'Discover 125M', 'Discover 125T', 'Discover 125 ST',
    'Discover 135', 'Discover 135 DTSi',
    'Discover 150', 'Discover 150F', 'Discover 150S',

    // Platina Series
    'Platina 100', 'Platina 100 ES', 'Platina 100 KS', 'Platina 100 Comfortec',
    'Platina 110', 'Platina 110 H-Gear', 'Platina 110 ABS',

    // CT Series
    'CT 100', 'CT 100B', 'CT 100 ES', 'CT 100 KS',
    'CT 110', 'CT 110X', 'CT 110X ES',

    // Dominar Series
    'Dominar 250', 'Dominar 400', 'Dominar 400 ABS', 'Dominar 400 UG',

    // Avenger Series
    'Avenger 150', 'Avenger 150 Street',
    'Avenger 160', 'Avenger 160 Street', 'Avenger 160 ABS',
    'Avenger 180', 'Avenger 180 Street',
    'Avenger 200', 'Avenger 200 Street',
    'Avenger 220', 'Avenger 220 Cruise', 'Avenger 220 Street', 'Avenger 220 DTS-i',

    // Other Models
    'Freedom 125', 'Freedom 125 NG',
    'V12', 'V15',
    'Boxer 100', 'Boxer 150', 'Boxer BM100', 'Boxer BM150',
    'Caliber 115', 'Wind 125',
  ],

  // TVS - Complete model variations
  'TVS': [
    // Apache RTR Series
    'Apache RTR 160', 'Apache RTR 160 2V', 'Apache RTR 160 2V BS6',
    'Apache RTR 160 4V', 'Apache RTR 160 4V DDS', 'Apache RTR 160 4V Disc',
    'Apache RTR 160 4V Special Edition',
    'Apache RTR 180', 'Apache RTR 180 ABS',
    'Apache RTR 200', 'Apache RTR 200 4V', 'Apache RTR 200 4V Race Edition',
    'Apache RTR 200 4V ABS', 'Apache RTR 200 4V 2.0',
    'Apache RR 310', 'Apache RR 310 BTO',
    'Apache RTR 310',

    // Raider Series
    'Raider 125', 'Raider 125 Disc', 'Raider 125 Drum',
    'Raider 125 SuperSquad Edition',

    // Ronin Series
    'Ronin', 'Ronin DS', 'Ronin SS',

    // Star City Series
    'Star City', 'Star City Plus', 'Star City Plus ES', 'Star City Plus Special Edition',

    // Sport Series
    'Sport', 'Max 100', 'Max 100R', 'Max 4R',

    // Radeon Series
    'Radeon', 'Radeon BS6', 'Radeon Special Edition',

    // Jupiter Series
    'Jupiter', 'Jupiter 110', 'Jupiter Classic', 'Jupiter ZX',
    'Jupiter ZX Disc', 'Jupiter Grande', 'Jupiter 125',

    // Ntorq Series
    'Ntorq 125', 'Ntorq 125 Race Edition', 'Ntorq 125 SuperSquad Edition',
    'Ntorq 125 XT', 'Ntorq 150',

    // Other Scooters
    'Scooty Pep Plus', 'Scooty Pep Plus BS6', 'Scooty Zest 110',
    'Zest 110', 'Zest 110 Himalayan Highs',
    'Wego', 'Wego 110',

    // XL Series
    'XL 100', 'XL 100 Heavy Duty', 'XL 100 Comfort', 'XL 100 Win Edition',

    // Electric
    'iQube', 'iQube S', 'iQube ST', 'iQube Electric',
    'TVS X',
  ],

  // HERO - Complete model variations
  'Hero': [
    // Splendor Series
    'Splendor', 'Splendor Plus', 'Splendor Plus i3s', 'Splendor Plus XTEC',
    'Splendor Plus XTEC 2.0', 'Splendor Plus Black and Accent',
    'Splendor Plus Million Edition', 'Splendor Plus Self Start',
    'Splendor Pro', 'Splendor Pro Classic', 'Splendor NXG',
    'Splendor iSmart', 'Splendor iSmart 110', 'Splendor iSmart 110 FI',
    'Super Splendor', 'Super Splendor BS6', 'Super Splendor XTEC',
    'Super Splendor iSmart', 'Super Splendor 125',

    // Passion Series
    'Passion', 'Passion Plus', 'Passion Pro', 'Passion Pro i3s',
    'Passion Pro TR', 'Passion XTEC', 'Passion X Pro',

    // HF Series
    'HF Deluxe', 'HF Deluxe i3s', 'HF Deluxe BS6', 'HF Deluxe Self Start',
    'HF Deluxe Eco', 'HF Deluxe IBS',
    'HF 100', 'HF Dawn', 'HF CD Dawn',

    // Glamour Series
    'Glamour', 'Glamour FI', 'Glamour 125', 'Glamour PGM-FI',
    'Glamour XTEC', 'Glamour X', 'Glamour Blaze', 'Glamour Drum',

    // Xtreme Series
    'Xtreme 125R', 'Xtreme 125R Connected',
    'Xtreme 160R', 'Xtreme 160R 2V', 'Xtreme 160R 4V', 'Xtreme 160R Stealth',
    'Xtreme 160R Connected',
    'Xtreme 200R', 'Xtreme 200S', 'Xtreme 200S 4V',
    'Xtreme 250R',
    'Xtreme Sports',

    // Xpulse Series
    'Xpulse 200', 'Xpulse 200 4V', 'Xpulse 200T', 'Xpulse 200T 4V',
    'Xpulse 200 Rally Kit', 'Xpulse 210', 'Xpulse 210 Dakar',

    // Karizma Series
    'Karizma', 'Karizma R', 'Karizma ZMR', 'Karizma XMR', 'Karizma XMR 210',

    // Achiever Series
    'Achiever', 'Achiever 150',

    // Maestro Series
    'Maestro', 'Maestro Edge', 'Maestro Edge 110', 'Maestro Edge 125',
    'Maestro Edge 125 XTEC',

    // Pleasure Series
    'Pleasure', 'Pleasure Plus', 'Pleasure Plus XTEC', 'Pleasure Plus 110',

    // Destini Series
    'Destini 125', 'Destini 125 XTEC', 'Destini Prime',

    // Premium
    'Mavrick 440',
    'Harley-Davidson X440', 'Harley-Davidson X440 S', 'Harley-Davidson X440 T',

    // CD Series (Discontinued)
    'CD 100', 'CD 100 SS', 'CD Dawn', 'CD Deluxe',

    // Impulse
    'Impulse', 'Impulse 150',
  ],

  // HONDA - Complete model variations
  'Honda': [
    // Shine Series
    'Shine', 'Shine 100', 'Shine 100 Drum', 'Shine 100 DX',
    'Shine 125', 'Shine 125 Drum', 'Shine 125 Disc',
    'CB Shine', 'CB Shine SP', 'CB Shine SP 125', 'CB Shine DX',

    // SP Series
    'SP 125', 'SP 125 STD', 'SP 125 DLX', 'SP 125 Anniversary Edition',
    'SP 160', 'SP 160 Single Disc', 'SP 160 Dual Disc',

    // Unicorn Series
    'Unicorn', 'Unicorn 150', 'Unicorn 160', 'CB Unicorn',
    'CB Unicorn 150', 'CB Unicorn 160', 'CB Unicorn Dazzler',

    // Hornet Series
    'Hornet', 'Hornet 2.0', 'CB Hornet 160R', 'CB Hornet 160R ABS',
    'Hornet 750', 'Hornet 1000 SP',
    'CB125 Hornet', 'CB125F',

    // CB Series
    'CB200X', 'CB300F', 'CB300R', 'CB300R Café',
    'CB350', 'CB350 Hness', 'CB350 RS', 'CB350 Anniversary Edition',
    'CB350C', 'CB350C DLX', 'CB350C DLX Special Edition',
    'CB500F', 'CB500X', 'CB650R',
    'CBR250R', 'CBR650R',
    'CB Trigger',

    // Livo Series
    'Livo', 'Livo Drum', 'Livo Disc', 'Livo BS6',

    // Dream Series
    'Dream', 'Dream Neo', 'Dream Yuga', 'CD 110 Dream',
    'CD 110 Dream DX', 'CD 110 Dream Deluxe',

    // Twister
    'CB Twister', 'Twister',

    // X-Blade
    'X-Blade', 'X-Blade 160', 'X-Blade ABS',

    // Adventure/Big Bikes
    'NX200', 'NX500',
    'CRF1100L Africa Twin', 'Africa Twin',
    'XL750 Transalp',
    'X-Adv', 'X-ADV 750',
    'Hayabusa', // (Suzuki but often searched)

    // Activa Series
    'Activa', 'Activa 3G', 'Activa 4G', 'Activa 5G', 'Activa 6G',
    'Activa 110', 'Activa 110 DLX', 'Activa 110 STD',
    'Activa 125', 'Activa 125 DLX', 'Activa 125 STD', 'Activa 125 Anniversary Edition',
    'Activa H-Smart', 'Activa Premium Edition',
    'Activa e', 'Activa e S', 'Activa e VX',

    // Dio Series
    'Dio', 'Dio 110', 'Dio 110 DLX', 'Dio 110 STD', 'Dio 110 Repsol Edition',
    'Dio 125', 'Dio 125 DLX', 'Dio 125 STD',
    'Dio Sports',

    // Grazia Series
    'Grazia', 'Grazia 125', 'Grazia 125 DLX', 'Grazia 125 Sports Edition',

    // Aviator
    'Aviator', 'Aviator 110',

    // Electric
    'QC1',

    // Gold Wing
    'Gold Wing', 'Gold Wing Tour', 'GL1800 Gold Wing',
  ],

  // YAMAHA - Complete model variations
  'Yamaha': [
    // FZ Series
    'FZ', 'FZ 16', 'FZ-S', 'FZ-S V2.0', 'FZ-S V3.0', 'FZ-S FI',
    'FZ-S FI V2.0', 'FZ-S FI V3.0', 'FZ-S FI V4.0', 'FZ-S FI V4.0 DLX',
    'FZ-S FI Hybrid', 'FZ-S FI Dark Knight',
    'FZ-FI', 'FZ-FI V3.0',
    'FZ-X', 'FZ-X Hybrid', 'FZ-X Chrome',
    'FZ25', 'FZ25 ABS', 'FZS 25',

    // R Series
    'R15', 'R15 V1', 'R15 V2', 'R15 V3', 'R15 V4',
    'R15S', 'R15S V3',
    'R15M', 'R15M Monster Energy MotoGP Edition',
    'R15 Connected', 'R15 Racing Blue', 'R15 Dark Knight',
    'R3', 'YZF-R3',
    'R6', 'YZF-R6',
    'R7', 'YZF-R7',
    'R1', 'YZF-R1', 'YZF-R1M',

    // MT Series
    'MT-15', 'MT-15 V2', 'MT-15 V2 DLX', 'MT-15 V2 Monster Energy',
    'MT-25',
    'MT-03', 'MT-07', 'MT-09', 'MT-10',

    // XSR Series
    'XSR 155', 'XSR 155 Legacy',
    'XSR 700', 'XSR 900',

    // Fazer Series
    'Fazer', 'Fazer FI', 'Fazer 25', 'Fazer 25 ABS',

    // SZ Series
    'SZ', 'SZ-R', 'SZ-S', 'SZ-RR', 'SZ-X',

    // Saluto Series
    'Saluto', 'Saluto 125', 'Saluto RX',

    // Ray Series
    'Ray', 'Ray Z', 'Ray ZR', 'Ray ZR 125', 'Ray ZR 125 FI',
    'Ray ZR Street Rally', 'Ray ZR Street Rally 125',

    // Fascino Series
    'Fascino', 'Fascino 110', 'Fascino 125', 'Fascino 125 FI',
    'Fascino 125 Hybrid', 'Fascino Elegance',

    // Cygnus Series
    'Cygnus', 'Cygnus Alpha', 'Cygnus Ray ZR',

    // Aerox
    'Aerox 155', 'Aerox 155 Connected', 'Aerox 155 MotoGP Edition',
    'Aerox S', 'Aerox Maxi',

    // NMAX
    'NMAX', 'NMAX 155', 'NMAX Connected',

    // RX Series (Classic)
    'RX 100', 'RX 135', 'RX-Z', 'RXG',

    // YBR/YBX Series
    'YBR 110', 'YBR 125',

    // Crux
    'Crux', 'Crux Rev', 'Crux S',

    // Alba/Enticer
    'Alba', 'Enticer',

    // SS/RD
    'SS 125', 'RD 350',
  ],

  // ROYAL ENFIELD - Complete model variations
  'Royal Enfield': [
    // Bullet Series
    'Bullet 350', 'Bullet 350 ES', 'Bullet 350 Standard',
    'Bullet 350 Military Silver', 'Bullet 350 Black Gold',
    'Bullet 350 Battalion Black', 'Bullet 350 Onyx Black',
    'Bullet 500', 'Bullet 500 EFI',
    'Bullet Electra', 'Bullet Electra 5S', 'Bullet Electra Twinspark',
    'Bullet Machismo',

    // Classic Series
    'Classic 350', 'Classic 350 Redditch', 'Classic 350 Signals',
    'Classic 350 Chrome', 'Classic 350 Dark', 'Classic 350 Halcyon',
    'Classic 350 Reborn', 'Classic 350 J Series',
    'Classic 500', 'Classic 500 Chrome', 'Classic 500 Stealth Black',
    'Classic 500 Pegasus', 'Classic 500 Desert Storm',
    'Classic 650',

    // Goan Classic
    'Goan Classic 350', 'Goan Classic 350 Blue', 'Goan Classic 350 Green',

    // Meteor Series
    'Meteor 350', 'Meteor 350 Fireball', 'Meteor 350 Stellar',
    'Meteor 350 Supernova', 'Meteor 350 Aurora',

    // Hunter Series
    'Hunter 350', 'Hunter 350 Retro', 'Hunter 350 Metro',
    'Hunter 350 Dapper Ash', 'Hunter 350 Dapper Grey',
    'Hunter 350 Rebel Series',

    // Himalayan Series
    'Himalayan', 'Himalayan 411', 'Himalayan 450',
    'Himalayan Sleet', 'Himalayan Lake Blue',
    'Himalayan Granite Black', 'Himalayan Pine Green',

    // Scram Series
    'Scram 411', 'Scram 440',
    'Scram Blazing Black', 'Scram Graphite Blue',

    // Guerrilla
    'Guerrilla 450', 'Guerrilla Playa Black', 'Guerrilla Brava Blue',

    // Continental GT
    'Continental GT', 'Continental GT 535', 'Continental GT 650',
    'Continental GT 650 Chrome', 'Continental GT 650 Rocker',
    'Continental GT 650 Mr Clean',

    // Interceptor
    'Interceptor 650', 'Interceptor 650 Chrome',
    'Interceptor 650 Standard', 'Interceptor 650 Custom',
    'Interceptor Bear 650',

    // Super Meteor
    'Super Meteor 650', 'Super Meteor 650 Tourer',
    'Super Meteor 650 Astral', 'Super Meteor 650 Celestial',

    // Shotgun
    'Shotgun 650', 'Shotgun 650 Plasma Blue', 'Shotgun 650 Stencil White',

    // Thunderbird
    'Thunderbird', 'Thunderbird 350', 'Thunderbird 350X',
    'Thunderbird 500', 'Thunderbird 500X',
  ],

  // SUZUKI - Complete model variations
  'Suzuki': [
    // Gixxer Series
    'Gixxer', 'Gixxer 150', 'Gixxer 155', 'Gixxer FI', 'Gixxer ABS',
    'Gixxer SF', 'Gixxer SF 150', 'Gixxer SF FI',
    'Gixxer 250', 'Gixxer SF 250', 'Gixxer SF 250 FI',
    'Gixxer SF 250 FFV', 'Gixxer SF 250 Special Edition',

    // GSX Series
    'GSX-R150', 'GSX-R250', 'GSX-R600', 'GSX-R750', 'GSX-R1000',
    'GSX-R1000R',
    'GSX-S125', 'GSX-S750', 'GSX-S1000',
    'GSX-8R', 'GSX-8S',

    // V-Strom Series
    'V-Strom SX', 'V-Strom 250', 'V-Strom 650', 'V-Strom 650 XT',
    'V-Strom 800 DE', 'V-Strom 1050', 'V-Strom 1050 XT',

    // Hayabusa
    'Hayabusa', 'GSX1300R Hayabusa',

    // Intruder Series
    'Intruder', 'Intruder 150', 'Intruder FI',

    // Access Series
    'Access', 'Access 125', 'Access 125 SE', 'Access 125 Special Edition',
    'Access 125 Drum', 'Access 125 Disc', 'Access 125 CBS',
    'Let\'s', 'Let\'s 110',

    // Burgman Series
    'Burgman', 'Burgman Street', 'Burgman Street 125',
    'Burgman Street EX', 'Burgman Street Bluetooth',
    'Burgman 200', 'Burgman 400', 'Burgman 650',

    // Avenis
    'Avenis', 'Avenis 125', 'Avenis Race Edition',

    // Electric
    'e Access', 'e Burgman',

    // Classic/Discontinued
    'GS150R', 'Slingshot', 'Slingshot Plus',
    'Heat', 'Zeus', 'Bandit', 'Bandit 150',
    'Swish', 'Swish 125',
    'Fiero', 'Shogun', 'Samurai', 'Max 100', 'Max 100R',
  ],

  // KAWASAKI - Complete model variations
  'Kawasaki': [
    // Ninja Series
    'Ninja 125', 'Ninja 250', 'Ninja 250R', 'Ninja 250SL',
    'Ninja 300', 'Ninja 300 ABS', 'Ninja 300 KRT Edition',
    'Ninja 400', 'Ninja 400 KRT',
    'Ninja 500', 'Ninja 650', 'Ninja 650 KRT',
    'Ninja ZX-4R', 'Ninja ZX-4RR',
    'Ninja ZX-6R', 'Ninja ZX-6R KRT',
    'Ninja ZX-10R', 'Ninja ZX-10R KRT', 'Ninja ZX-10RR',
    'Ninja H2', 'Ninja H2R', 'Ninja H2 SX', 'Ninja H2 SX SE',
    'Ninja 1000SX',

    // Z Series
    'Z125', 'Z250', 'Z400', 'Z500', 'Z650', 'Z650RS',
    'Z800', 'Z900', 'Z900RS', 'Z900RS Cafe',
    'Z H2', 'Z H2 SE',
    'Z1000',

    // Versys Series
    'Versys 650', 'Versys 1000', 'Versys-X 300',

    // Vulcan Series
    'Vulcan S', 'Vulcan S Cafe', 'Vulcan 900',

    // W Series
    'W175', 'W175 Cafe', 'W175 Street',
    'W800', 'W800 Cafe', 'W800 Street',

    // KLX Series
    'KLX 110', 'KLX 140', 'KLX 230', 'KLX 300',

    // KX Series
    'KX 65', 'KX 85', 'KX 100', 'KX 250', 'KX 450',

    // Eliminator
    'Eliminator', 'Eliminator 400', 'Eliminator SE',

    // Retro/Classic
    'Meguro', 'Meguro K3', 'Meguro S1',
  ],

  // KTM - Complete model variations
  'KTM': [
    // Duke Series
    'Duke 125', '125 Duke',
    'Duke 200', '200 Duke', '200 Duke ABS',
    'Duke 250', '250 Duke', '250 Duke ABS',
    'Duke 390', '390 Duke', '390 Duke ABS',
    'Duke 690', '690 Duke',
    'Duke 790', '790 Duke',
    'Duke 890', '890 Duke', '890 Duke R',
    'Duke 990', '990 Duke', '990 Duke R',
    'Duke 1290', '1290 Super Duke R', '1290 Super Duke GT',

    // RC Series
    'RC 125', 'RC 200', 'RC 390', 'RC 8C',

    // Adventure Series
    '250 Adventure', '390 Adventure', '390 Adventure X',
    '790 Adventure', '790 Adventure R',
    '890 Adventure', '890 Adventure R',
    '1290 Super Adventure', '1290 Super Adventure S', '1290 Super Adventure R',

    // Enduro/Motocross
    'EXC 250', 'EXC 300', 'EXC-F 250', 'EXC-F 350', 'EXC-F 450', 'EXC-F 500',
    'SX 125', 'SX 250', 'SX-F 250', 'SX-F 350', 'SX-F 450',
    'Freeride', 'Freeride E-XC',
  ],

  // HUSQVARNA - Complete model variations
  'Husqvarna': [
    // Svartpilen
    'Svartpilen 125', 'Svartpilen 200', 'Svartpilen 250', 'Svartpilen 401',

    // Vitpilen
    'Vitpilen 125', 'Vitpilen 250', 'Vitpilen 401', 'Vitpilen 701',

    // Norden
    'Norden 901', 'Norden 901 Expedition',

    // Enduro
    'FE 250', 'FE 350', 'FE 450', 'FE 501',
    'TE 150i', 'TE 250i', 'TE 300i',

    // Motocross
    'FC 250', 'FC 350', 'FC 450',
    'TC 125', 'TC 250',
  ],
}

async function runMigration() {
  console.log('Starting model variations migration...')

  let totalModelsAdded = 0

  for (const [makeName, models] of Object.entries(modelVariations)) {
    // Find the make
    const make = await db.query.vehicleMakes.findFirst({
      where: eq(vehicleMakes.name, makeName),
    })

    if (!make) {
      console.log(`Make "${makeName}" not found, skipping...`)
      continue
    }

    console.log(`Processing ${makeName}...`)

    for (const modelName of models) {
      // Check if model already exists for this make
      const existingModel = await db.query.vehicleModels.findFirst({
        where: and(
          eq(vehicleModels.makeId, make.id),
          eq(vehicleModels.name, modelName)
        ),
      })

      if (!existingModel) {
        await db.insert(vehicleModels).values({
          makeId: make.id,
          name: modelName,
          isActive: true,
        })
        totalModelsAdded++
      }
    }
  }

  console.log('Migration completed successfully!')
  console.log(`Added ${totalModelsAdded} new model variations.`)
  process.exit(0)
}

runMigration().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
