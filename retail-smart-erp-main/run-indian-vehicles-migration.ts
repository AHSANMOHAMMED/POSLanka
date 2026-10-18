import 'dotenv/config'
import { db } from './src/lib/db'
import { vehicleMakes, vehicleModels } from './src/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// Indian Car Makes and Models
const indianVehicleData = {
  // Maruti Suzuki - India's largest car manufacturer (separate from Suzuki Japan)
  'Maruti Suzuki': {
    country: 'India',
    models: [
      // Hatchbacks
      'Alto 800', 'Alto K10', 'S-Presso', 'Celerio', 'Celerio X', 'WagonR', 'Swift',
      'Ignis', 'Baleno', 'Ritz',
      // Sedans
      'Dzire', 'Ciaz',
      // SUVs & Crossovers
      'Vitara Brezza', 'Brezza', 'Fronx', 'Grand Vitara', 'Jimny', 'S-Cross',
      // MPVs
      'Ertiga', 'XL6', 'Invicto', 'Eeco',
      // Vans
      'Omni', 'Versa',
      // Commercial
      'Super Carry',
      // Discontinued/Classic
      'Zen', 'Zen Estilo', 'A-Star', 'Esteem', 'SX4', 'Gypsy', 'Maruti 800',
      '1000', 'Kizashi', 'Baleno RS'
    ]
  },

  // Tata Motors - India's third largest car manufacturer
  'Tata Motors': {
    country: 'India',
    models: [
      // Hatchbacks
      'Tiago', 'Tiago NRG', 'Tiago EV', 'Altroz', 'Altroz Racer', 'Altroz CNG',
      'Bolt', 'Zest', 'Vista', 'Indica', 'Indica Vista', 'Nano',
      // Sedans
      'Tigor', 'Tigor EV', 'Manza', 'Indigo', 'Indigo eCS', 'Indigo Marina',
      // SUVs & Crossovers
      'Punch', 'Punch EV', 'Nexon', 'Nexon EV', 'Nexon EV Max', 'Harrier',
      'Harrier EV', 'Safari', 'Safari Storme', 'Curvv', 'Curvv EV', 'Sierra',
      'Hexa', 'Aria',
      // Premium
      'Avinya',
      // Commercial/Utility
      'Sumo', 'Sumo Gold', 'Sumo Grande', 'Sumo Victa', 'Xenon', 'Xenon XT',
      'Yodha', 'Winger', 'Magic', 'Magic Iris',
      // EVs
      'Tiago.ev', 'Tigor.ev', 'Punch.ev', 'Nexon.ev', 'Curvv.ev', 'Harrier.ev',
      'Sierra EV', 'Safari EV'
    ]
  },

  // Mahindra & Mahindra
  'Mahindra': {
    country: 'India',
    models: [
      // Current SUVs
      'Thar', 'Thar Roxx', 'Thar 5-Door', 'Thar.e', 'Scorpio', 'Scorpio-N',
      'Scorpio Classic', 'Scorpio Getaway', 'Bolero', 'Bolero Neo', 'Bolero.e',
      'XUV300', 'XUV400', 'XUV 3XO', 'XUV500', 'XUV700', 'XUV 7XO', 'XUV900',
      // Premium/Electric
      'BE 6', 'BE 07', 'XEV 9e', 'XEV 9S',
      // MPVs
      'Marazzo', 'Xylo',
      // Sedans
      'Verito', 'Verito Vibe', 'e2o', 'e2o Plus',
      // Commercial/Utility
      'Bolero Camper', 'Bolero Pik-Up', 'Bolero Maxi Truck', 'Bolero MaXX',
      'Armada', 'Commander', 'Marshal', 'MM 540', 'MM 550', 'Major', 'Voyager',
      // Discontinued/Classic
      'Classic', 'CL 500', 'Invader', 'Jeep CJ', 'Thar 700', 'Legend',
      'Scorpio S11', 'TUV300', 'TUV300 Plus', 'KUV100', 'KUV100 NXT', 'NuvoSport',
      'Quanto', 'Rexton', 'Ssangyong Rexton', 'Alturas G4',
      // Pick-ups
      'Scorpio Pik-Up', 'Imperio', 'Global Pik-Up',
      // Jeep/Classic Heritage
      'Willys Jeep', 'CJ3B', 'CJ4', 'CJ340', 'CJ500', 'CJ640'
    ]
  },

  // Force Motors
  'Force Motors': {
    country: 'India',
    models: [
      'Gurkha', 'Gurkha 3-Door', 'Gurkha 5-Door', 'Gurkha Xtreme', 'Gurkha Hard Top',
      'Gurkha Soft Top', 'Trax', 'Trax Cruiser', 'Trax Toofan', 'Traveller',
      'Traveller 26', 'Traveller 3350', 'Traveller 3700', 'Urbania',
      'One', 'Tempo', 'Tempo Traveller', 'Trump', 'Citiline', 'Matador',
      'Kargo King', 'Shaktiman'
    ]
  },

  // Hindustan Motors (Classic Indian brand)
  'Hindustan Motors': {
    country: 'India',
    models: [
      'Ambassador', 'Ambassador Classic', 'Ambassador Grand', 'Ambassador Nova',
      'Ambassador Avigo', 'Ambassador Encore', 'Ambassador Mark I', 'Ambassador Mark II',
      'Ambassador Mark III', 'Ambassador Mark IV', 'Contessa', 'Contessa Classic',
      'Contessa GL', 'Trekker', 'Porter', 'Pushpak', 'Winner'
    ]
  },

  // Premier Automobiles (Indian)
  'Premier': {
    country: 'India',
    models: [
      'Padmini', 'Padmini S1', 'Premier 118 NE', 'Premier 137 D', 'Premier NE',
      'Rio', 'Rio Diesel', 'Sigma', 'Stanza'
    ]
  },

  // Ashok Leyland (Primarily commercial but some passenger vehicles)
  'Ashok Leyland': {
    country: 'India',
    models: [
      'Stile', 'Dost', 'Dost Plus', 'Dost Strong', 'Dost Lite', 'Bada Dost',
      'Partner', 'MiTR', 'Oyster', 'Lynx', 'Circuit', 'Guru', 'Boss', 'Comet',
      'Viking', 'Tusker', 'Taurus', 'Eagle', 'Falcon', 'Stallion'
    ]
  },

  // Eicher (Commercial with some passenger variants)
  'Eicher': {
    country: 'India',
    models: [
      'Pro 2000', 'Pro 3000', 'Pro 5000', 'Pro 6000', 'Pro 8000', 'Starline',
      'Skyline', 'Skyline Pro'
    ]
  },

  // ICML (International Cars and Motors Limited)
  'ICML': {
    country: 'India',
    models: [
      'Rhino', 'Rhino Rx', 'Extreme', 'Extreme Win', 'Mountech', 'Winger'
    ]
  },

  // Pravaig (Indian EV startup)
  'Pravaig': {
    country: 'India',
    models: [
      'Defy', 'Extinction MK1', 'Extinction MK2'
    ]
  },

  // Tork Motors (Indian EV motorcycle)
  'Tork Motors': {
    country: 'India',
    models: [
      'Kratos', 'Kratos R', 'Kratos X'
    ]
  },

  // Ather Energy (Indian EV scooters)
  'Ather': {
    country: 'India',
    models: [
      '450X', '450 Plus', '450S', '450 Apex', 'Rizta', 'Rizta Z', 'Rizta S'
    ]
  },

  // Ola Electric (Indian EV scooters)
  'Ola Electric': {
    country: 'India',
    models: [
      'S1', 'S1 Pro', 'S1 Air', 'S1 X', 'S1 X Plus', 'Roadster', 'Roadster Pro',
      'Roadster X', 'Adventure'
    ]
  },

  // Simple Energy (Indian EV)
  'Simple Energy': {
    country: 'India',
    models: [
      'Simple One', 'Simple Dot'
    ]
  },

  // Ultraviolette (Indian EV motorcycle)
  'Ultraviolette': {
    country: 'India',
    models: [
      'F77', 'F77 Mach 2', 'F77 Recon'
    ]
  },

  // Jawa Motorcycles (Czech brand, Indian revival)
  'Jawa': {
    country: 'India',
    models: [
      'Jawa', 'Jawa 42', 'Jawa 42 Bobber', 'Jawa Perak', 'Jawa 350', 'Yezdi Adventure',
      'Yezdi Scrambler', 'Yezdi Roadster', 'Yezdi Roadking'
    ]
  },

  // BSA (British brand, Indian revival)
  'BSA': {
    country: 'India',
    models: [
      'Gold Star 650', 'Gold Star'
    ]
  },

  // LML (Indian scooter brand revival)
  'LML': {
    country: 'India',
    models: [
      'Star', 'Star Euro'
    ]
  },

  // Kinetic (Indian)
  'Kinetic': {
    country: 'India',
    models: [
      'Nova', 'Luna', 'Kinetic Honda', 'Marvel', 'Zing', 'Boss', 'GF', 'Flyte',
      'Comet', 'Velocity', 'Zoom', 'Pride'
    ]
  },

  // Bajaj Auto - Adding more car models (three-wheelers are popular transport)
  'Bajaj': {
    country: 'India',
    models: [
      // Cars (historical)
      'Qute', 'RE60',
      // Three-wheelers (passenger)
      'RE', 'RE Auto', 'RE 4S', 'RE Compact', 'Maxima', 'Maxima C', 'Maxima Z'
    ]
  }
}

async function runMigration() {
  console.log('Starting Indian vehicles migration...')

  let totalMakesAdded = 0
  let totalModelsAdded = 0

  for (const [makeName, data] of Object.entries(indianVehicleData)) {
    // Check if make already exists
    const existingMake = await db.query.vehicleMakes.findFirst({
      where: eq(vehicleMakes.name, makeName),
    })

    let makeId: string

    if (existingMake) {
      console.log(`${makeName} already exists, adding new models...`)
      makeId = existingMake.id
    } else {
      // Create new make
      console.log(`Adding ${makeName}...`)
      const [newMake] = await db.insert(vehicleMakes).values({
        name: makeName,
        country: data.country,
        isActive: true,
      }).returning()
      makeId = newMake.id
      totalMakesAdded++
    }

    // Add models
    for (const modelName of data.models) {
      // Check if model already exists for this make
      const existingModel = await db.query.vehicleModels.findFirst({
        where: and(
          eq(vehicleModels.makeId, makeId),
          eq(vehicleModels.name, modelName)
        ),
      })

      if (!existingModel) {
        await db.insert(vehicleModels).values({
          makeId,
          name: modelName,
          isActive: true,
        })
        totalModelsAdded++
      }
    }
  }

  console.log('Migration completed successfully!')
  console.log(`Added ${totalMakesAdded} new makes and ${totalModelsAdded} new models.`)
  process.exit(0)
}

runMigration().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
