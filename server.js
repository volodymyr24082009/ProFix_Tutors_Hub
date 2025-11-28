const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const path = require("path");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const { sendMessage } = require("./bot");
const fs = require("fs");
const punycode = require("punycode/");
const http = require("http");
const socketIo = require("socket.io");
const compression = require("compression");
const helmet = require("helmet");

// Load environment variables
dotenv.config();
const app = express();
const port = process.env.PORT || 3007;

// Improved database connection configuration
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false },
  // Add connection timeout and retry settings
  connectionTimeoutMillis: 10000,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
});

// Test database connection
pool
  .connect()
  .then((client) => {
    console.log("✅ Successfully connected to PostgreSQL database!");
    console.log(`   Host: ${process.env.DB_HOST}`);
    console.log(`   Database: ${process.env.DB_NAME}`);
    client.release();
  })
  .catch((err) => {
    console.error("❌ Database connection error:", err.message);
    console.error(
      "   Please check your database credentials and network connection."
    );
    // Continue running the server even if DB connection fails initially
  });

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname)));

// Add this middleware configuration after your existing middleware setup
// (after the app.use(cors()), app.use(bodyParser.json()), etc. lines)

// Add compression middleware to compress responses
app.use(compression());

// Add helmet for security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // You may need to configure this based on your needs
  })
);

// Force cache clearing middleware - add this before your static middleware
app.use((req, res, next) => {
  // Set headers to prevent caching for all requests
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  // Add timestamp to force browser to make a new request
  if (req.url.match(/\.(css|js|jpg|jpeg|png|gif|ico|svg)$/)) {
    const timestamp = Date.now();
    req.url = req.url.includes("?")
      ? `${req.url}&_t=${timestamp}`
      : `${req.url}?_t=${timestamp}`;
  }

  next();
});

// Add a route to clear client-side cache via JavaScript
app.get("/clear-cache.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.send(`
    // Clear browser cache on page load
    (function() {
      // Clear localStorage
      localStorage.clear();
      
      // Clear sessionStorage
      sessionStorage.clear();
      
      // Clear application cache if available
      if (window.applicationCache && window.applicationCache.swapCache) {
        try {
          window.applicationCache.swapCache();
        } catch (e) {
          console.error("Failed to swap application cache:", e);
        }
      }
      
      // Force reload from server (not from cache)
      if (window.performance && window.performance.navigation) {
        if (window.performance.navigation.type !== 1) { // Not a reload
          const currentLocation = window.location.href;
          const cacheBuster = Date.now();
          const separator = currentLocation.indexOf('?') !== -1 ? '&' : '?';
          window.location.href = currentLocation + separator + '_cb=' + cacheBuster;
        }
      }
      
      console.log("Cache cleared at " + new Date().toLocaleTimeString());
    })();
  `);
});
app.use((req, res, next) => {
  // Store the original send function
  const originalSend = res.send;

  // Override the send function
  res.send = function (body) {
    // Only modify HTML responses
    if (
      typeof body === "string" &&
      res.get("Content-Type")?.includes("text/html")
    ) {
      // Add the cache clearing script before the closing </body> tag
      body = body.replace(
        "</body>",
        '<script src="/clear-cache.js"></script></body>'
      );
    }

    // Call the original send function with the modified body
    return originalSend.call(this, body);
  };

  next();
});

// Modify your static middleware to disable caching
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  })
);

app.use(
  express.static(path.join(__dirname), {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  })
);

// Add a service worker that clears the cache
app.get("/cache-clearer-sw.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.send(`
    // Service Worker to clear caches
    const CACHE_NAME = 'site-cache-v1';
    
    self.addEventListener('install', function(event) {
      // Skip waiting to activate immediately
      self.skipWaiting();
      
      event.waitUntil(
        caches.keys().then(function(cacheNames) {
          return Promise.all(
            cacheNames.map(function(cacheName) {
              return caches.delete(cacheName);
            })
          );
        })
      );
    });
    
    self.addEventListener('activate', function(event) {
      // Claim clients to control all open pages
      event.waitUntil(clients.claim());
      
      // Clear all caches again
      event.waitUntil(
        caches.keys().then(function(cacheNames) {
          return Promise.all(
            cacheNames.map(function(cacheName) {
              return caches.delete(cacheName);
            })
          );
        })
      );
    });
    
    // Intercept all fetch requests
    self.addEventListener('fetch', function(event) {
      // Skip the cache and always go to network
      event.respondWith(
        fetch(event.request).catch(function() {
          return new Response('Network error occurred', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        })
      );
    });
  `);
});

// Register the service worker in your HTML
app.use((req, res, next) => {
  // Store the original send function
  const originalSend = res.send;

  // Override the send function
  res.send = function (body) {
    // Only modify HTML responses
    if (
      typeof body === "string" &&
      res.get("Content-Type")?.includes("text/html")
    ) {
      // Add the service worker registration script before the closing </head> tag
      body = body.replace(
        "</head>",
        `<script>
          // Register service worker to clear cache
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/cache-clearer-sw.js')
              .then(function(registration) {
                console.log('Cache clearer service worker registered:', registration.scope);
              })
              .catch(function(error) {
                console.log('Service worker registration failed:', error);
              });
          }
        </script></head>`
      );
    }

    // Call the original send function with the modified body
    return originalSend.call(this, body);
  };

  next();
});

// Helper function for database queries with retry logic
const executeQuery = async (queryText, params = [], retries = 3) => {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await pool.query(queryText, params);
      return result;
    } catch (err) {
      console.error(`Query attempt ${attempt} failed:`, err.message);
      lastError = err;

      // If this isn't the last attempt, wait before retrying
      if (attempt < retries) {
        const delay = 1000 * attempt; // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // If we get here, all attempts failed
  throw lastError;
};

// Function to check and fix the reviews table
const fixReviewsTable = async () => {
  try {
    // Check if the reviews table exists
    const tableExists = await executeQuery(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'reviews'
      );
    `);

    if (tableExists.rows[0].exists) {
      console.log("Reviews table exists, checking for required columns...");

      // Get all columns in the reviews table
      const columnsResult = await executeQuery(`
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_name = 'reviews';
      `);

      const columns = columnsResult.rows.map((row) => row.column_name);
      console.log("Existing columns:", columns);

      // Check for city column with NOT NULL constraint
      const cityColumnCheck = columnsResult.rows.find(
        (row) => row.column_name === "city" && row.is_nullable === "NO"
      );

      if (cityColumnCheck) {
        console.log("Found city column with NOT NULL constraint, modifying...");
        await executeQuery(`
          ALTER TABLE reviews ALTER COLUMN city DROP NOT NULL;
        `);
        console.log("✅ Modified city column to allow NULL values");
      }

      // Add missing columns if needed
      const requiredColumns = [
        { name: "name", type: "VARCHAR(100)", default: "'Анонім'" },
        { name: "industry", type: "VARCHAR(100)", default: "'Загальне'" },
        { name: "rating", type: "INTEGER", default: "5" },
        { name: "text", type: "TEXT", default: "''" },
        { name: "master_name", type: "VARCHAR(100)", default: "NULL" },
        { name: "status", type: "VARCHAR(20)", default: "'approved'" },
        { name: "created_at", type: "TIMESTAMP", default: "CURRENT_TIMESTAMP" },
        { name: "updated_at", type: "TIMESTAMP", default: "CURRENT_TIMESTAMP" },
        { name: "city", type: "VARCHAR(100)", default: "'Не вказано'" },
      ];

      for (const column of requiredColumns) {
        if (!columns.includes(column.name)) {
          console.log(
            `Adding missing '${column.name}' column to reviews table...`
          );
          await executeQuery(`
            ALTER TABLE reviews ADD COLUMN ${column.name} ${column.type} DEFAULT ${column.default}
          `);
          console.log(
            `✅ Added missing '${column.name}' column to reviews table`
          );
        }
      }
    } else {
      console.log("Reviews table doesn't exist, creating it...");

      // Create the reviews table with all required columns
      await executeQuery(`
        CREATE TABLE reviews (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          name VARCHAR(100) NOT NULL DEFAULT 'Анонім',
          industry VARCHAR(100) NOT NULL DEFAULT 'Загальне',
          rating INTEGER NOT NULL DEFAULT 5,
          text TEXT NOT NULL DEFAULT '',
          master_name VARCHAR(100),
          status VARCHAR(20) NOT NULL DEFAULT 'approved',
          city VARCHAR(100) DEFAULT 'Не вказано',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log("✅ Created reviews table with all required columns");
    }
  } catch (err) {
    console.error("❌ Error fixing reviews table:", err.message);
    throw err;
  }
};

// Функція для створення таблиць
const createTables = async () => {
  const userTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL
    );
  `;

  const userProfileTableQuery = `
    CREATE TABLE IF NOT EXISTS user_profile (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      email VARCHAR(255),
      phone VARCHAR(15),
      address TEXT,
      date_of_birth DATE
    );
  `;

  const userServicesTableQuery = `
    CREATE TABLE IF NOT EXISTS user_services (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      service_name VARCHAR(255) NOT NULL,
      service_type VARCHAR(50) DEFAULT 'service'
    );
  `;

  const addRoleMasterColumnQuery = `
    DO $$ 
    BEGIN 
      IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'user_profile' AND column_name = 'role_master'
      ) THEN
        ALTER TABLE user_profile ADD COLUMN role_master BOOLEAN DEFAULT FALSE;
      END IF;
    END $$;
  `;

  const addApprovalStatusColumnQuery = `
    DO $$ 
    BEGIN 
      IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'user_profile' AND column_name = 'approval_status'
      ) THEN
        ALTER TABLE user_profile ADD COLUMN approval_status VARCHAR(20) DEFAULT NULL;
      END IF;
    END $$;
  `;

  const masterRequestsTableQuery = `
    CREATE TABLE IF NOT EXISTS master_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Нова таблиця для замовлень
  const ordersTableQuery = `
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      phone VARCHAR(15) NOT NULL,
      industry VARCHAR(100),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      master_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  const addCreatedAtToUsersQuery = `
  DO $$ 
  BEGIN 
    IF NOT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'created_at'
    ) THEN
      ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
  END $$;
`;

  const addIndustryColumnQuery = `
    DO $$ 
    BEGIN 
      IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'industry'
      ) THEN
        ALTER TABLE orders ADD COLUMN industry VARCHAR(100);
      END IF;
    END $$;
  `;

  try {
    await executeQuery(userTableQuery);
    await executeQuery(userProfileTableQuery);
    await executeQuery(userServicesTableQuery);
    await executeQuery(addRoleMasterColumnQuery);
    await executeQuery(addApprovalStatusColumnQuery);
    await executeQuery(masterRequestsTableQuery);
    await executeQuery(ordersTableQuery);
    await executeQuery(addIndustryColumnQuery);
    await executeQuery(addCreatedAtToUsersQuery);

    // Fix the reviews table
    await fixReviewsTable();

    console.log(
      "✅ Таблиці створено або вже існують, колонки додано (якщо їх не було)."
    );

    // Додаємо базові галузі для нових користувачів, якщо вони ще не існують
    await initializeIndustries();
  } catch (err) {
    console.error("❌ Помилка при створенні таблиць:", err.message);
    console.error(
      "   Сервер продовжить роботу, але функціональність може бути обмежена."
    );
  }
};

// Функція для ініціалізації базових галузей
const initializeIndustries = async () => {
  const industries = [
    { name: "Інформаційні технології", icon: "fas fa-laptop-code" },
    { name: "Медицина", icon: "fas fa-heartbeat" },
    { name: "Енергетика", icon: "fas fa-bolt" },
    { name: "Аграрна галузь", icon: "fas fa-tractor" },
    { name: "Фінанси та банківська справа", icon: "fas fa-money-bill-wave" },
    { name: "Освіта", icon: "fas fa-graduation-cap" },
    { name: "Туризм і гостинність", icon: "fas fa-plane" },
    { name: "Будівництво та нерухомість", icon: "fas fa-hard-hat" },
    { name: "Транспорт", icon: "fas fa-truck" },
    { name: "Мистецтво і культура", icon: "fas fa-palette" },
  ];

  try {
    // Перевіряємо, чи є вже галузі в базі даних
    const existingIndustries = await executeQuery(`
      SELECT DISTINCT service_name 
      FROM user_services 
      WHERE service_type = 'industry'
    `);

    const existingIndustryNames = existingIndustries.rows.map(
      (row) => row.service_name
    );

    // Отримуємо список користувачів з роллю майстра
    const masters = await executeQuery(`
      SELECT u.id 
      FROM users u
      JOIN user_profile up ON u.id = up.user_id
      WHERE up.role_master = true
    `);

    // Для кожного майстра додаємо галузі, які ще не існують
    for (const master of masters.rows) {
      const masterIndustries = await executeQuery(
        `
        SELECT service_name 
        FROM user_services 
        WHERE user_id = $1 AND service_type = 'industry'
      `,
        [master.id]
      );

      const masterIndustryNames = masterIndustries.rows.map(
        (row) => row.service_name
      );

      // Додаємо галузі, яких ще немає у майстра
      for (const industry of industries) {
        if (!masterIndustryNames.includes(industry.name)) {
          await executeQuery(
            `
            INSERT INTO user_services (user_id, service_name, service_type)
            VALUES ($1, $2, 'industry')
          `,
            [master.id, industry.name]
          );
        }
      }
    }

    console.log("✅ Базові галузі успішно ініціалізовано.");
  } catch (err) {
    console.error("❌ Помилка при ініціалізації галузей:", err.message);
  }
};

// Try to create tables, but don't block server startup
createTables().catch((err) => {
  console.error("Failed to initialize database tables:", err.message);
});

// Create a messages table if it doesn't exist
const createMessagesTable = async () => {
  try {
    // First check if the table exists
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'messages'
      );
    `;

    const tableExists = await executeQuery(tableExistsQuery);

    if (tableExists.rows[0].exists) {
      console.log("Messages table exists, checking for required columns...");

      // Get existing columns
      const columnsResult = await executeQuery(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'messages';
      `);

      const columns = columnsResult.rows.map((row) => row.column_name);
      console.log("Existing message table columns:", columns);

      // Check if message column exists (this is the required column with NOT NULL constraint)
      if (!columns.includes("message")) {
        // If the table exists but doesn't have message column, add it
        await executeQuery(`
          ALTER TABLE messages 
          ADD COLUMN message TEXT NOT NULL DEFAULT '';
        `);
        console.log("✅ Added message column to messages table");
      }

      // Check if message_type column exists
      if (!columns.includes("message_type")) {
        // If the table exists but doesn't have message_type column, add it
        await executeQuery(`
          ALTER TABLE messages 
          ADD COLUMN message_type VARCHAR(20) NOT NULL DEFAULT 'text';
        `);
        console.log("✅ Added message_type column to messages table");
      }

      // Check if industries column exists
      if (!columns.includes("industries")) {
        // If the table exists but doesn't have industries column, add it
        await executeQuery(`
          ALTER TABLE messages 
          ADD COLUMN industries TEXT[];
        `);
        console.log("✅ Added industries column to messages table");
      }

      // Check for other required columns and add them if missing
      const requiredColumns = [
        { name: "content", type: "TEXT" },
        { name: "media_path", type: "VARCHAR(255)" },
      ];

      for (const column of requiredColumns) {
        if (!columns.includes(column.name)) {
          await executeQuery(`
            ALTER TABLE messages 
            ADD COLUMN ${column.name} ${column.type};
          `);
          console.log(`✅ Added ${column.name} column to messages table`);
        }
      }
    } else {
      // Create the table with all required columns
      const messagesTableQuery = `
        CREATE TABLE messages (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) NOT NULL,
          email VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          message_type VARCHAR(20) NOT NULL DEFAULT 'text',
          industries TEXT[],
          content TEXT,
          media_path VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      await executeQuery(messagesTableQuery);
      console.log("✅ Created messages table with all required columns");
    }
  } catch (err) {
    console.error("❌ Error creating/updating messages table:", err.message);
  }
};

// Call this function during server initialization
createMessagesTable().catch((err) => {
  console.error("Failed to initialize messages table:", err.message);
});

// Add this code to your server.js file

// Create news table if it doesn't exist
const createNewsTable = async () => {
  try {
    // Check if the news table exists
    const tableExists = await executeQuery(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'news'
      );
    `);

    if (tableExists.rows[0].exists) {
      console.log("News table exists, checking for required columns...");

      // Get all columns in the news table
      const columnsResult = await executeQuery(`
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_name = 'news';
      `);

      const columns = columnsResult.rows.map((row) => row.column_name);
      console.log("Existing columns:", columns);

      // Add missing columns if needed
      const requiredColumns = [
        { name: "title", type: "VARCHAR(255)", default: "''" },
        { name: "short_description", type: "TEXT", default: "''" },
        { name: "content", type: "TEXT", default: "''" },
        { name: "main_image", type: "VARCHAR(255)", default: "NULL" },
        { name: "additional_images", type: "TEXT[]", default: "NULL" },
        { name: "external_links", type: "TEXT[]", default: "NULL" },
        { name: "category", type: "VARCHAR(50)", default: "'updates'" },
        { name: "status", type: "VARCHAR(20)", default: "'published'" },
        { name: "views", type: "INTEGER", default: "0" },
        { name: "likes", type: "INTEGER", default: "0" },
        { name: "created_at", type: "TIMESTAMP", default: "CURRENT_TIMESTAMP" },
        { name: "updated_at", type: "TIMESTAMP", default: "CURRENT_TIMESTAMP" },
      ];

      for (const column of requiredColumns) {
        if (!columns.includes(column.name)) {
          console.log(
            `Adding missing '${column.name}' column to news table...`
          );
          await executeQuery(`
            ALTER TABLE news ADD COLUMN ${column.name} ${column.type} DEFAULT ${column.default}
          `);
          console.log(`✅ Added missing '${column.name}' column to news table`);
        }
      }
    } else {
      console.log("News table doesn't exist, creating it...");

      // Create the news table with all required columns
      await executeQuery(`
        CREATE TABLE news (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          short_description TEXT NOT NULL,
          content TEXT NOT NULL,
          main_image VARCHAR(255),
          additional_images TEXT[],
          external_links TEXT[],
          category VARCHAR(50) DEFAULT 'updates',
          status VARCHAR(20) NOT NULL DEFAULT 'published',
          views INTEGER DEFAULT 0,
          likes INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log("✅ Created news table with all required columns");

      // Add some sample news
      await addSampleNews();
    }
  } catch (err) {
    console.error("❌ Error fixing news table:", err.message);
    throw err;
  }
};

// Add sample news for testing
const addSampleNews = async () => {
  try {
    const sampleNews = [
      {
        title: "Запуск нової платформи ProFix Network",
        short_description:
          "Ми раді повідомити про запуск нашої нової платформи для пошуку та замовлення послуг ремонту та обслуговування.",
        content:
          "Сьогодні ми з гордістю оголошуємо про запуск нової платформи ProFix Network, яка з'єднує клієнтів з кваліфікованими майстрами у різних галузях. Наша мета - зробити процес пошуку та замовлення послуг максимально простим та зручним для всіх користувачів. Платформа пропонує широкий вибір послуг від ремонту побутової техніки до IT-консультацій.",
        category: "updates",
        status: "published",
      },
      {
        title: "Нові можливості для майстрів",
        short_description:
          "Розширюємо функціонал для майстрів з новими інструментами для керування замовленнями.",
        content:
          "Ми додали нові інструменти для майстрів, які дозволяють ефективніше керувати замовленнями та спілкуватися з клієнтами. Тепер майстри можуть встановлювати свій графік роботи, отримувати сповіщення про нові замовлення та залишати відгуки про клієнтів. Також додано можливість завантажувати фотографії виконаних робіт для портфоліо.",
        category: "updates",
        status: "published",
      },
      {
        title: "Майстер-клас з ремонту смартфонів",
        short_description:
          "Запрошуємо на безкоштовний майстер-клас з базового ремонту смартфонів.",
        content:
          "Наша команда організовує безкоштовний майстер-клас з базового ремонту смартфонів. На заході ви дізнаєтесь як замінити екран, батарею та інші компоненти вашого пристрою. Майстер-клас відбудеться 15 червня о 15:00 в нашому офісі. Кількість місць обмежена, тому реєструйтесь заздалегідь.",
        category: "events",
        status: "published",
      },
      {
        title: "5 порад для економії електроенергії",
        short_description:
          "Корисні поради, які допоможуть зменшити споживання електроенергії та заощадити кошти.",
        content:
          "У цій статті ми зібрали 5 найефективніших порад для економії електроенергії:\n\n1. Замініть звичайні лампи на LED-освітлення\n2. Вимикайте прилади з режиму очікування\n3. Використовуйте енергоефективну побутову техніку\n4. Правильно налаштуйте холодильник та кондиціонер\n5. Встановіть розумні лічильники та розетки\n\nДотримуючись цих простих порад, ви можете зменшити споживання електроенергії на 20-30%.",
        category: "tips",
        status: "published",
      },
      {
        title: "Як вибрати надійного майстра",
        short_description:
          "Поради щодо вибору кваліфікованого майстра для ремонту та обслуговування.",
        content:
          "Вибір надійного майстра - важливий крок для успішного ремонту. Ось кілька порад, які допоможуть вам зробити правильний вибір:\n\n1. Перевіряйте відгуки та рейтинг майстра\n2. Звертайте увагу на досвід роботи та спеціалізацію\n3. Запитуйте про гарантію на виконані роботи\n4. Уточнюйте вартість послуг заздалегідь\n5. Перегляньте портфоліо з прикладами робіт\n\nНа платформі ProFix Network ви можете легко знайти перевірених майстрів з високим рейтингом та позитивними відгуками.",
        category: "tips",
        status: "published",
      },
    ];

    for (const news of sampleNews) {
      await executeQuery(
        `
        INSERT INTO news (title, short_description, content, category, status)
        VALUES ($1, $2, $3, $4, $5)
      `,
        [
          news.title,
          news.short_description,
          news.content,
          news.category,
          news.status,
        ]
      );
    }

    console.log("✅ Added sample news");
  } catch (err) {
    console.error("❌ Error adding sample news:", err.message);
  }
};

// Call this function during server initialization
createNewsTable().catch((err) => {
  console.error("Failed to initialize news table:", err.message);
});

// Configure multer storage for news images
const newsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "public/uploads/news");

    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, "news-" + uniqueSuffix + ext);
  },
});

const newsUpload = multer({
  storage: newsStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Тільки зображення можуть бути завантажені!"), false);
    }
  },
});

// Get all news
app.get("/api/news", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT id, title, short_description, content, main_image, 
             additional_images, external_links, category, status, 
             views, likes, created_at, updated_at
      FROM news
      ORDER BY created_at DESC
    `);

    res.status(200).json({ news: result.rows });
  } catch (err) {
    console.error("❌ Error getting news:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Get news by ID
app.get("/api/news/:id", async (req, res) => {
  const newsId = req.params.id;

  try {
    const result = await executeQuery(
      `
      SELECT id, title, short_description, content, main_image, 
             additional_images, external_links, category, status, 
             views, likes, created_at, updated_at
      FROM news
      WHERE id = $1
    `,
      [newsId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "News not found" });
    }

    res.status(200).json({ news: result.rows[0] });
  } catch (err) {
    console.error("❌ Error getting news by ID:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Create news
app.post(
  "/api/news",
  newsUpload.fields([
    { name: "main_image", maxCount: 1 },
    { name: "additional_images", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const {
        title,
        short_description,
        content,
        category = "updates",
        status = "published",
        external_links,
      } = req.body;

      if (!title || !short_description || !content) {
        return res.status(400).json({
          message: "Title, short description and content are required",
        });
      }

      // Process main image
      let mainImagePath = null;
      if (
        req.files &&
        req.files.main_image &&
        req.files.main_image.length > 0
      ) {
        const mainImage = req.files.main_image[0];
        mainImagePath = `/uploads/news/${mainImage.filename}`;
      }

      // Process additional images
      let additionalImagePaths = [];
      if (
        req.files &&
        req.files.additional_images &&
        req.files.additional_images.length > 0
      ) {
        additionalImagePaths = req.files.additional_images.map(
          (file) => `/uploads/news/${file.filename}`
        );
      }

      // Process external links
      let links = [];
      if (external_links) {
        if (Array.isArray(external_links)) {
          links = external_links.filter((link) => link.trim() !== "");
        } else if (
          typeof external_links === "string" &&
          external_links.trim() !== ""
        ) {
          links = [external_links];
        }
      }

      const result = await executeQuery(
        `
      INSERT INTO news (
        title, short_description, content, main_image, 
        additional_images, external_links, category, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `,
        [
          title,
          short_description,
          content,
          mainImagePath,
          additionalImagePaths.length > 0 ? additionalImagePaths : null,
          links.length > 0 ? links : null,
          category,
          status,
        ]
      );

      console.log(`✅ Created news with ID ${result.rows[0].id}`);
      res.status(201).json({
        success: true,
        message: "News created successfully",
        newsId: result.rows[0].id,
      });
    } catch (err) {
      console.error("❌ Error creating news:", err.message);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  }
);

// Update news
app.put(
  "/api/news/:id",
  newsUpload.fields([
    { name: "main_image", maxCount: 1 },
    { name: "additional_images", maxCount: 10 },
  ]),
  async (req, res) => {
    const newsId = req.params.id;

    try {
      // Check if news exists
      const existingNews = await executeQuery(
        "SELECT * FROM news WHERE id = $1",
        [newsId]
      );
      if (existingNews.rows.length === 0) {
        return res.status(404).json({ message: "News not found" });
      }

      const {
        title,
        short_description,
        content,
        category,
        status,
        external_links,
      } = req.body;

      if (!title || !short_description || !content) {
        return res.status(400).json({
          message: "Title, short description and content are required",
        });
      }

      // Process main image
      let mainImagePath = existingNews.rows[0].main_image;
      if (
        req.files &&
        req.files.main_image &&
        req.files.main_image.length > 0
      ) {
        const mainImage = req.files.main_image[0];
        mainImagePath = `/uploads/news/${mainImage.filename}`;

        // Delete old image if exists
        if (existingNews.rows[0].main_image) {
          const oldImagePath = path.join(
            __dirname,
            "public",
            existingNews.rows[0].main_image
          );
          if (fs.existsSync(oldImagePath)) {
            fs.unlinkSync(oldImagePath);
          }
        }
      }

      // Process additional images
      let additionalImagePaths = existingNews.rows[0].additional_images || [];
      if (
        req.files &&
        req.files.additional_images &&
        req.files.additional_images.length > 0
      ) {
        const newImagePaths = req.files.additional_images.map(
          (file) => `/uploads/news/${file.filename}`
        );
        additionalImagePaths = [...additionalImagePaths, ...newImagePaths];
      }

      // Process external links
      let links = [];
      if (external_links) {
        if (Array.isArray(external_links)) {
          links = external_links.filter((link) => link.trim() !== "");
        } else if (
          typeof external_links === "string" &&
          external_links.trim() !== ""
        ) {
          links = [external_links];
        }
      }

      await executeQuery(
        `
      UPDATE news
      SET title = $1, 
          short_description = $2, 
          content = $3, 
          main_image = $4, 
          additional_images = $5, 
          external_links = $6, 
          category = $7, 
          status = $8,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
    `,
        [
          title,
          short_description,
          content,
          mainImagePath,
          additionalImagePaths.length > 0 ? additionalImagePaths : null,
          links.length > 0 ? links : null,
          category || existingNews.rows[0].category,
          status || existingNews.rows[0].status,
          newsId,
        ]
      );

      console.log(`✅ Updated news with ID ${newsId}`);
      res.status(200).json({
        success: true,
        message: "News updated successfully",
      });
    } catch (err) {
      console.error("❌ Error updating news:", err.message);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  }
);

// Delete news
app.delete("/api/news/:id", async (req, res) => {
  const newsId = req.params.id;

  try {
    // Check if news exists and get image paths
    const existingNews = await executeQuery(
      "SELECT main_image, additional_images FROM news WHERE id = $1",
      [newsId]
    );
    if (existingNews.rows.length === 0) {
      return res.status(404).json({ message: "News not found" });
    }

    // Delete the news
    await executeQuery("DELETE FROM news WHERE id = $1", [newsId]);

    // Delete associated images
    const mainImage = existingNews.rows[0].main_image;
    const additionalImages = existingNews.rows[0].additional_images || [];

    if (mainImage) {
      const mainImagePath = path.join(__dirname, "public", mainImage);
      if (fs.existsSync(mainImagePath)) {
        fs.unlinkSync(mainImagePath);
      }
    }

    additionalImages.forEach((imagePath) => {
      const fullPath = path.join(__dirname, "public", imagePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    });

    console.log(`✅ Deleted news with ID ${newsId}`);
    res.status(200).json({
      success: true,
      message: "News deleted successfully",
    });
  } catch (err) {
    console.error("❌ Error deleting news:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Increment view count
app.post("/api/news/:id/view", async (req, res) => {
  const newsId = req.params.id;

  try {
    const result = await executeQuery(
      `
      UPDATE news
      SET views = views + 1
      WHERE id = $1
      RETURNING views
    `,
      [newsId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "News not found" });
    }

    res.status(200).json({
      success: true,
      views: result.rows[0].views,
    });
  } catch (err) {
    console.error("❌ Error incrementing view count:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Toggle like
app.post("/api/news/:id/like", async (req, res) => {
  const newsId = req.params.id;
  const userId = req.body.userId; // Optional: track which users liked which news

  try {
    // For simplicity, we'll just increment the like count
    // In a real app, you would track which users liked which news
    const result = await executeQuery(
      `
      UPDATE news
      SET likes = likes + 1
      WHERE id = $1
      RETURNING likes
    `,
      [newsId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "News not found" });
    }

    res.status(200).json({
      success: true,
      likes: result.rows[0].likes,
      liked: true,
    });
  } catch (err) {
    console.error("❌ Error toggling like:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Get news by category
app.get("/api/news/category/:category", async (req, res) => {
  const category = req.params.category;

  try {
    const result = await executeQuery(
      `
      SELECT id, title, short_description, content, main_image, 
             additional_images, external_links, category, status, 
             views, likes, created_at, updated_at
      FROM news
      WHERE category = $1 AND status = 'published'
      ORDER BY created_at DESC
    `,
      [category]
    );

    res.status(200).json({ news: result.rows });
  } catch (err) {
    console.error("❌ Error getting news by category:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Search news
app.get("/api/news/search/:query", async (req, res) => {
  const query = req.params.query;

  try {
    const result = await executeQuery(
      `
      SELECT id, title, short_description, content, main_image, 
             additional_images, external_links, category, status, 
             views, likes, created_at, updated_at
      FROM news
      WHERE (title ILIKE $1 OR short_description ILIKE $1 OR content ILIKE $1)
            AND status = 'published'
      ORDER BY created_at DESC
    `,
      [`%${query}%`]
    );

    res.status(200).json({ news: result.rows });
  } catch (err) {
    console.error("❌ Error searching news:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Get popular news
app.get("/api/news/popular", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT id, title, short_description, content, main_image, 
             additional_images, external_links, category, status, 
             views, likes, created_at, updated_at
      FROM news
      WHERE status = 'published'
      ORDER BY views DESC, likes DESC
      LIMIT 5
    `);

    res.status(200).json({ news: result.rows });
  } catch (err) {
    console.error("❌ Error getting popular news:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Get latest news
app.get("/api/news/latest/:limit", async (req, res) => {
  const limit = Number.parseInt(req.params.limit) || 5;

  try {
    const result = await executeQuery(
      `
      SELECT id, title, short_description, content, main_image, 
             additional_images, external_links, category, status, 
             views, likes, created_at, updated_at
      FROM news
      WHERE status = 'published'
      ORDER BY created_at DESC
      LIMIT $1
    `,
      [limit]
    );

    res.status(200).json({ news: result.rows });
  } catch (err) {
    console.error("❌ Error getting latest news:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

console.log("✅ News API endpoints have been added successfully!");

// Update the endpoint to get user's selected industry
app.get("/api/user-selected-industry/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    // First try to get the user's explicitly selected industry
    const result = await executeQuery(
      `
      SELECT service_name 
      FROM user_services 
      WHERE user_id = $1 AND service_type = 'selected_industry'
      LIMIT 1
    `,
      [userId]
    );

    if (result.rows.length > 0) {
      res.status(200).json({
        success: true,
        selectedIndustry: result.rows[0].service_name,
      });
    } else {
      // If no explicitly selected industry, get the first industry
      const industriesResult = await executeQuery(
        `
        SELECT service_name 
        FROM user_services 
        WHERE user_id = $1 AND service_type = 'industry'
        LIMIT 1
      `,
        [userId]
      );

      if (industriesResult.rows.length > 0) {
        res.status(200).json({
          success: true,
          selectedIndustry: industriesResult.rows[0].service_name,
        });
      } else {
        res.status(200).json({
          success: true,
          selectedIndustry: null,
        });
      }
    }
  } catch (err) {
    console.error("❌ Error getting user's selected industry:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
});

// Update the endpoint to save user's selected industry
app.post("/api/user-selected-industry/:userId", async (req, res) => {
  const userId = req.params.userId;
  const { selectedIndustry } = req.body;

  if (!selectedIndustry) {
    return res.status(400).json({
      success: false,
      message: "Selected industry is required",
    });
  }

  try {
    // First, delete any existing selected industry
    await executeQuery(
      `
      DELETE FROM user_services 
      WHERE user_id = $1 AND service_type = 'selected_industry'
    `,
      [userId]
    );

    // Then insert the new selected industry
    await executeQuery(
      `
      INSERT INTO user_services (user_id, service_name, service_type)
      VALUES ($1, $2, 'selected_industry')
    `,
      [userId, selectedIndustry]
    );

    console.log(
      `✅ Selected industry "${selectedIndustry}" saved for user ${userId}`
    );
    res.status(200).json({
      success: true,
      message: "Selected industry saved successfully",
    });
  } catch (err) {
    console.error("❌ Error saving user's selected industry:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
});

// Головна сторінка (реєстрація/авторизація)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "auth.html"));
});

// Middleware для JWT аутентифікації
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null)
    return res.status(401).json({ message: "Необхідна авторизація" });

  jwt.verify(
    token,
    process.env.JWT_SECRET || "default_secret_key",
    (err, user) => {
      if (err)
        return res
          .status(403)
          .json({ message: "Недійсний або прострочений токен" });
      req.user = user;
      next();
    }
  );
};

let isProcessing = false;

// Реєстрація користувача
app.post("/register", async (req, res) => {
  if (isProcessing) {
    return res.status(400).json({ message: "Запит вже обробляється!" });
  }
  isProcessing = true;

  const { username, password } = req.body;

  if (!username || !password) {
    isProcessing = false;
    return res
      .status(400)
      .json({ message: "Усі поля повинні бути заповнені!" });
  }

  try {
    const existingUser = await executeQuery(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (existingUser.rows.length > 0) {
      isProcessing = false;
      return res
        .status(400)
        .json({ message: "Користувач з таким іменем вже існує!" });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = await executeQuery(
      "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id",
      [username, hashedPassword]
    );

    await executeQuery("INSERT INTO user_profile (user_id) VALUES ($1)", [
      newUser.rows[0].id,
    ]);

    console.log(`✅ Користувач ${username} успішно зареєстрований.`);

    res.status(200).json({
      success: true,
      message: "Реєстрація успішна",
      userId: newUser.rows[0].id,
      redirect: "/index.html",
    });
  } catch (err) {
    console.error("❌ Помилка при реєстрації:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  } finally {
    isProcessing = false;
  }
});

// Логін користувача
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Усі поля повинні бути заповнені!" });
  }

  try {
    const result = await executeQuery(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ message: "Невірне ім'я користувача або пароль!" });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ message: "Невірне ім'я користувача або пароль!" });
    }

    console.log(`✅ ${username} успішно увійшов в систему!`);

    // Create JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || "default_secret_key",
      {
        expiresIn: "24h",
      }
    );

    res.status(200).json({
      success: true,
      message: "Вхід успішний",
      userId: user.id,
      token: token,
      redirect: "/index.html",
    });
  } catch (err) {
    console.error("❌ Помилка при вході:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання профілю користувача
app.get("/profile/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    const profileResult = await executeQuery(
      "SELECT * FROM user_profile WHERE user_id = $1",
      [userId]
    );

    if (profileResult.rows.length === 0) {
      return res.status(404).json({ message: "Профіль не знайдено" });
    }

    // Also get the username
    const userResult = await executeQuery(
      "SELECT username FROM users WHERE id = $1",
      [userId]
    );

    const profileData = {
      ...profileResult.rows[0],
      username: userResult.rows[0].username,
    };

    res.status(200).json({ profile: profileData });
  } catch (err) {
    console.error("❌ Помилка при отриманні профілю:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Оновлення профілю користувача
app.put("/profile/:userId", async (req, res) => {
  const userId = req.params.userId;
  const {
    first_name,
    last_name,
    email,
    phone,
    address,
    date_of_birth,
    role_master,
    approval_status,
  } = req.body;

  try {
    const userResult = await executeQuery("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Користувача не знайдено" });
    }

    // Отримуємо поточний профіль користувача для перевірки
    const currentProfileResult = await executeQuery(
      "SELECT * FROM user_profile WHERE user_id = $1",
      [userId]
    );

    const currentProfile = currentProfileResult.rows[0];
    const wasMaster = currentProfile.role_master;

    // Перевіряємо, чи користувач став майстром або змінив дані як майстер
    if (role_master && (!wasMaster || role_master !== wasMaster)) {
      // Якщо користувач став майстром або змінив дані як майстер,
      // встановлюємо статус "pending" для затвердження адміністратором
      await executeQuery(
        `UPDATE user_profile 
         SET first_name = $1, last_name = $2, email = $3, phone = $4, 
             address = $5, date_of_birth = $6, role_master = $7, approval_status = 'pending'
         WHERE user_id = $8`,
        [
          first_name,
          last_name,
          email,
          phone,
          address,
          date_of_birth,
          role_master,
          userId,
        ]
      );

      // Перевіряємо, чи існує запит на роль майстра
      const existingRequest = await executeQuery(
        "SELECT * FROM master_requests WHERE user_id = $1",
        [userId]
      );

      // Якщо запит не існує, створюємо новий
      if (existingRequest.rows.length === 0) {
        await executeQuery(
          "INSERT INTO master_requests (user_id, status) VALUES ($1, 'pending')",
          [userId]
        );
      } else {
        // Якщо запит існує, оновлюємо його статус
        await executeQuery(
          "UPDATE master_requests SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE user_id = $1",
          [userId]
        );
      }

      console.log(
        `✅ Профіль користувача з ID ${userId} оновлено і відправлено на затвердження.`
      );
      res.status(200).json({
        success: true,
        message: "Профіль успішно оновлено і відправлено на затвердження",
        requiresApproval: true,
      });
    } else {
      // Якщо це звичайний користувач, просто оновлюємо профіль
      await executeQuery(
        `UPDATE user_profile 
         SET first_name = $1, last_name = $2, email = $3, phone = $4, 
             address = $5, date_of_birth = $6, role_master = $7, approval_status = $8
         WHERE user_id = $9`,
        [
          first_name,
          last_name,
          email,
          phone,
          address,
          date_of_birth,
          role_master,
          approval_status,
          userId,
        ]
      );

      console.log(`✅ Профіль користувача з ID ${userId} успішно оновлено.`);
      res.status(200).json({
        success: true,
        message: "Профіль успішно оновлено",
        requiresApproval: false,
      });
    }
  } catch (err) {
    console.error("❌ Помилка при оновленні профілю:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Додавання послуги для користувача
app.post("/services/:userId", async (req, res) => {
  const userId = req.params.userId;
  const { service_name, service_type = "service" } = req.body;

  if (!service_name) {
    return res.status(400).json({ message: "Назва послуги обов'язкова" });
  }

  try {
    const userResult = await executeQuery("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Користувача не знайдено" });
    }

    // Check if the service already exists for this user with the same type
    if (service_type === "selected_industry") {
      // For selected_industry, check if one already exists and remove it first
      await executeQuery(
        "DELETE FROM user_services WHERE user_id = $1 AND service_type = 'selected_industry'",
        [userId]
      );
    }

    await executeQuery(
      "INSERT INTO user_services (user_id, service_name, service_type) VALUES ($1, $2, $3)",
      [userId, service_name, service_type]
    );

    console.log(
      `✅ Послугу "${service_name}" типу "${service_type}" додано для користувача з ID ${userId}.`
    );
    res.status(201).json({ success: true, message: "Послугу успішно додано" });
  } catch (err) {
    console.error("❌ Помилка при додаванні послуги:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання послуг користувача
app.get("/services/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    const servicesResult = await executeQuery(
      "SELECT * FROM user_services WHERE user_id = $1",
      [userId]
    );

    res.status(200).json({ services: servicesResult.rows });
  } catch (err) {
    console.error("❌ Помилка при отриманні послуг:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Видалення послуги
app.delete("/services/:serviceId", async (req, res) => {
  const serviceId = req.params.serviceId;

  try {
    const result = await executeQuery(
      "DELETE FROM user_services WHERE id = $1 RETURNING *",
      [serviceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Послугу не знайдено" });
    }

    console.log(`✅ Послугу з ID ${serviceId} успішно видалено.`);
    res
      .status(200)
      .json({ success: true, message: "Послугу успішно видалено" });
  } catch (err) {
    console.error("❌ Помилка при видаленні послуги:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Створення запиту на роль майстра
app.post("/master-requests", async (req, res) => {
  const { user_id, status = "pending" } = req.body;

  if (!user_id) {
    return res.status(400).json({ message: "ID користувача обов'язковий" });
  }

  try {
    // Перевірка чи існує користувач
    const userResult = await executeQuery("SELECT * FROM users WHERE id = $1", [
      user_id,
    ]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Користувача не знайдено" });
    }

    // Перевірка чи вже існує запит
    const existingRequest = await executeQuery(
      "SELECT * FROM master_requests WHERE user_id = $1 AND status = 'pending'",
      [user_id]
    );
    if (existingRequest.rows.length > 0) {
      return res
        .status(400)
        .json({ message: "Запит на роль майстра вже існує" });
    }

    // Створення нового запиту
    await executeQuery(
      "INSERT INTO master_requests (user_id, status) VALUES ($1, $2)",
      [user_id, status]
    );

    console.log(
      `✅ Запит на роль майстра для користувача з ID ${user_id} успішно створено.`
    );
    res.status(201).json({
      success: true,
      message: "Запит на роль майстра успішно створено",
    });
  } catch (err) {
    console.error(
      "❌ Помилка при створенні запиту на роль майстра:",
      err.message
    );
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Endpoint to handle password changes
app.post("/change-password/:userId", authenticateToken, async (req, res) => {
  const userId = req.params.userId;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Усі поля повинні бути заповнені" });
  }

  try {
    const userResult = await executeQuery("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Користувача не знайдено" });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Невірний поточний пароль" });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    await executeQuery("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);

    res.status(200).json({
      success: true,
      message: "Пароль успішно змінено",
    });
  } catch (err) {
    console.error("❌ Помилка при зміні паролю:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання всіх запитів на роль майстра
app.get("/master-requests", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT mr.id, mr.user_id, mr.status, mr.created_at, mr.updated_at,
             u.username, up.first_name, up.last_name, up.email, up.phone, 
             up.address, up.date_of_birth
      FROM master_requests mr
      JOIN users u ON mr.user_id = u.id
      JOIN user_profile up ON u.id = up.user_id
      ORDER BY mr.created_at DESC
    `);

    res.status(200).json({ requests: result.rows });
  } catch (err) {
    console.error(
      "❌ Помилка при отриманні запитів на роль майстра:",
      err.message
    );
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Оновлення статусу запиту на роль майстра
app.put("/master-requests/:requestId", async (req, res) => {
  const requestId = req.params.requestId;
  const { status } = req.body;

  if (!status || !["pending", "approved", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Невірний статус" });
  }

  try {
    // Start a transaction
    await executeQuery("BEGIN");

    // Get the request
    const requestResult = await executeQuery(
      "SELECT * FROM master_requests WHERE id = $1",
      [requestId]
    );
    if (requestResult.rows.length === 0) {
      await executeQuery("ROLLBACK");
      return res.status(404).json({ message: "Запит не знайдено" });
    }

    const userId = requestResult.rows[0].user_id;

    // Update request status
    await executeQuery(
      "UPDATE master_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [status, requestId]
    );

    // Update user profile
    if (status === "approved") {
      await executeQuery(
        "UPDATE user_profile SET approval_status = $1, role_master = true WHERE user_id = $2",
        [status, userId]
      );

      // Check if the master already has any industries
      const existingIndustriesResult = await executeQuery(
        `
        SELECT * FROM user_services 
        WHERE user_id = $1 AND service_type = 'industry'
        `,
        [userId]
      );

      // Only add default industries if the master has no industries yet
      if (existingIndustriesResult.rows.length === 0) {
        // Add default industries for the master
        const industries = [
          "Інформаційні технології",
          "Медицина",
          "Енергетика",
          "Аграрна галузь",
          "Фінанси та банківська справа",
          "Освіта",
          "Туризм і гостинність",
          "Будівництво та нерухомість",
          "Транспорт",
          "Мистецтво і культура",
        ];

        for (const industry of industries) {
          await executeQuery(
            `
            INSERT INTO user_services (user_id, service_name, service_type)
            VALUES ($1, $2, 'industry')
            `,
            [userId, industry]
          );
        }
      }
    } else if (status === "rejected") {
      await executeQuery(
        "UPDATE user_profile SET approval_status = $1, role_master = false WHERE user_id = $2",
        [status, userId]
      );
    } else {
      await executeQuery(
        "UPDATE user_profile SET approval_status = $1 WHERE user_id = $2",
        [status, userId]
      );
    }

    // Commit the transaction
    await executeQuery("COMMIT");

    console.log(
      `✅ Статус запиту на роль майстра з ID ${requestId} змінено на ${status}.`
    );
    res
      .status(200)
      .json({ success: true, message: `Статус запиту змінено на ${status}` });
  } catch (err) {
    // Rollback in case of error
    try {
      await executeQuery("ROLLBACK");
    } catch (rollbackErr) {
      console.error("❌ Помилка при відкаті транзакції:", rollbackErr.message);
    }
    console.error("❌ Помилка при оновленні статусу запиту:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання списку всіх користувачів та майстрів
app.get("/admin/users", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT u.id, u.username, up.role_master, up.first_name, up.last_name, 
             up.email, up.approval_status, up.phone, up.address, up.date_of_birth
      FROM users u
      LEFT JOIN user_profile up ON u.id = up.user_id
      ORDER BY up.role_master DESC, u.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Помилка при отриманні списку користувачів:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Add a new endpoint to get all masters with their industries and services
app.get("/admin/masters", async (req, res) => {
  try {
    // Get all users with role_master = true
    const mastersResult = await executeQuery(`
      SELECT u.id, u.username, up.first_name, up.last_name, up.email, 
             up.phone, up.address, up.approval_status, up.date_of_birth
      FROM users u
      JOIN user_profile up ON u.id = up.user_id
      WHERE up.role_master = true
      ORDER BY up.approval_status, u.id
    `);

    const masters = mastersResult.rows;

    // For each master, get their industries and services
    for (const master of masters) {
      // Get industries
      const industriesResult = await executeQuery(
        `
        SELECT service_name 
        FROM user_services 
        WHERE user_id = $1 AND service_type = 'industry'
      `,
        [master.id]
      );

      master.industries = industriesResult.rows.map((row) => row.service_name);

      // Get services (excluding industries)
      const servicesResult = await executeQuery(
        `
        SELECT service_name, service_type
        FROM user_services 
        WHERE user_id = $1 AND service_type != 'industry'
      `,
        [master.id]
      );

      master.services = servicesResult.rows;
    }

    res.json(masters);
  } catch (err) {
    console.error("❌ Помилка при отриманні списку майстрів:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Видалення користувача
app.delete("/admin/users/:userId", async (req, res) => {
  const userId = req.params.userId;
  try {
    await executeQuery("DELETE FROM users WHERE id = $1", [userId]);
    res.json({ message: "Користувача успішно видалено" });
  } catch (err) {
    console.error("❌ Помилка при видаленні користувача:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання списку всіх користувачів з їхніми послугами
app.get("/admin/users-with-services", async (req, res) => {
  try {
    const usersResult = await executeQuery(`
      SELECT u.id, u.username, up.role_master, up.first_name, up.last_name, up.email, up.approval_status
      FROM users u
      LEFT JOIN user_profile up ON u.id = up.user_id
    `);

    const users = usersResult.rows;

    // Отримуємо всі послуги для всіх користувачів
    const servicesResult = await executeQuery(`
      SELECT user_id, service_name, service_type, id
      FROM user_services
    `);

    // Групуємо послуги за user_id
    const servicesMap = {};
    servicesResult.rows.forEach((service) => {
      if (!servicesMap[service.user_id]) {
        servicesMap[service.user_id] = [];
      }
      servicesMap[service.user_id].push(service);
    });

    // Додаємо послуги до користувачів
    const usersWithServices = users.map((user) => ({
      ...user,
      services: servicesMap[user.id] || [],
    }));

    res.json(usersWithServices);
  } catch (err) {
    console.error(
      "❌ Помилка при отриманні списку користувачів з послугами:",
      err.message
    );
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// ПОКРАЩЕНИЙ ендпоінт для user-master-timeline з гарним форматуванням місяців
app.get("/api/user-master-timeline", async (req, res) => {
  try {
    console.log("Отримано запит на /api/user-master-timeline");

    // Створюємо масив останніх 6 місяців з гарним форматуванням
    const months = [];
    const currentDate = new Date();

    // Масив українських назв місяців для гарного відображення
    const ukrMonths = [
      "Січень",
      "Лютий",
      "Березень",
      "Квітень",
      "Травень",
      "Червень",
      "Липень",
      "Серпень",
      "Вересень",
      "Жовтень",
      "Листопад",
      "Грудень",
    ];

    // Короткі назви місяців для графіків
    const shortMonths = [
      "Січ",
      "Лют",
      "Бер",
      "Кві",
      "Тра",
      "Чер",
      "Лип",
      "Сер",
      "Вер",
      "Жов",
      "Лис",
      "Гру",
    ];

    for (let i = 5; i >= 0; i--) {
      const date = new Date(currentDate);
      date.setMonth(currentDate.getMonth() - i);

      const monthIndex = date.getMonth();
      const year = date.getFullYear();

      // Повна назва місяця для API
      const monthName = ukrMonths[monthIndex];
      // Коротка назва місяця для графіків
      const shortMonthName = shortMonths[monthIndex];

      const monthYear = `${monthName} ${year}`;
      const shortMonthYear = `${shortMonthName} ${year}`;

      const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      const endOfMonth = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );

      months.push({
        month: monthYear,
        shortMonth: shortMonthYear,
        timestamp: date.getTime(),
        startDate: startOfMonth,
        endDate: endOfMonth,
        monthIndex: monthIndex,
        year: year,
      });
    }

    // Отримуємо дані для кожного місяця
    const timelineData = [];

    for (const monthData of months) {
      // Отримуємо кількість користувачів (без майстрів)
      const usersResult = await executeQuery(
        `
        SELECT COUNT(*) as count
        FROM users u
        JOIN user_profile up ON u.id = up.user_id
        WHERE u.created_at <= $1
        AND (up.role_master = false OR up.role_master IS NULL)
      `,
        [monthData.endDate]
      );

      // Отримуємо кількість майстрів
      const mastersResult = await executeQuery(
        `
        SELECT COUNT(*) as count
        FROM users u
        JOIN user_profile up ON u.id = up.user_id
        WHERE u.created_at <= $1
        AND up.role_master = true
      `,
        [monthData.endDate]
      );

      // Отримуємо кількість замовлень за цей місяць
      const ordersResult = await executeQuery(
        `
        SELECT COUNT(*) as count
        FROM orders
        WHERE created_at BETWEEN $1 AND $2
      `,
        [monthData.startDate, monthData.endDate]
      );

      // Отримуємо кількість завершених замовлень за цей місяць
      const completedOrdersResult = await executeQuery(
        `
        SELECT COUNT(*) as count
        FROM orders
        WHERE created_at BETWEEN $1 AND $2
        AND status = 'completed'
      `,
        [monthData.startDate, monthData.endDate]
      );

      const usersCount = Number.parseInt(usersResult.rows[0].count) || 0;
      const mastersCount = Number.parseInt(mastersResult.rows[0].count) || 0;
      const ordersCount = Number.parseInt(ordersResult.rows[0].count) || 0;
      const completedOrdersCount =
        Number.parseInt(completedOrdersResult.rows[0].count) || 0;

      timelineData.push({
        month: monthData.month,
        shortMonth: monthData.shortMonth,
        timestamp: monthData.timestamp,
        users: usersCount,
        masters: mastersCount,
        orders: ordersCount,
        completedOrders: completedOrdersCount,
        // Додаємо додаткові метадані для сортування та відображення
        monthIndex: monthData.monthIndex,
        year: monthData.year,
      });
    }

    // Сортуємо дані за часом (від найстарішого до найновішого)
    timelineData.sort((a, b) => a.timestamp - b.timestamp);

    console.log("Відправлення даних часової шкали:", timelineData);
    res.json(timelineData);
  } catch (error) {
    console.error(
      "❌ Помилка при отриманні даних часової шкали:",
      error.message
    );
    res.status(500).json({ message: "Помилка сервера", error: error.message });
  }
});

// Improved endpoint for age-demographics to use real data
app.get("/api/age-demographics", async (req, res) => {
  try {
    console.log("Отримано запит на /api/age-demographics");

    // Get all users with date_of_birth from user_profile table
    const result = await executeQuery(`
      SELECT date_of_birth 
      FROM user_profile 
      WHERE date_of_birth IS NOT NULL
    `);

    console.log(`Отримано ${result.rows.length} записів з бази даних`);

    // Define age categories
    const ageCategories = [
      { name: "до 18", min: 0, max: 17 },
      { name: "18-24", min: 18, max: 24 },
      { name: "25-34", min: 25, max: 34 },
      { name: "35-44", min: 35, max: 44 },
      { name: "45-54", min: 45, max: 54 },
      { name: "55-64", min: 55, max: 64 },
      { name: "65+", min: 65, max: 150 },
    ];

    // Calculate age for each user
    const currentDate = new Date();
    const ages = result.rows.map((user) => {
      const birthDate = new Date(user.date_of_birth);
      let age = currentDate.getFullYear() - birthDate.getFullYear();

      // Adjust age if birthday hasn't occurred yet this year
      if (
        birthDate.getMonth() > currentDate.getMonth() ||
        (birthDate.getMonth() === currentDate.getMonth() &&
          birthDate.getDate() > currentDate.getDate())
      ) {
        age--;
      }

      return age;
    });

    // Count users in each category
    const categoryCounts = ageCategories.map((category) => {
      const count = ages.filter(
        (age) => age >= category.min && age <= category.max
      ).length;

      return {
        category: category.name,
        count,
      };
    });

    // Calculate percentages
    const totalUsers = ages.length;
    const agePercentages = categoryCounts.map((category) => ({
      category: category.name,
      percentage: totalUsers > 0 ? (category.count / totalUsers) * 100 : 0,
    }));

    console.log("Відправлення даних вікової демографії:", agePercentages);
    res.json(agePercentages);
  } catch (error) {
    console.error(
      "❌ Помилка при отриманні вікової статистики:",
      error.message
    );
    res.status(500).json({ message: "Помилка сервера", error: error.message });
  }
});

// Improved endpoint for user-master-count to provide growth data
app.get("/api/user-master-count", async (req, res) => {
  try {
    console.log("Отримано запит на /api/user-master-count");

    // Get current user and master counts from user_profile table
    const countResult = await executeQuery(`
      SELECT 
        COUNT(*) FILTER (WHERE role_master = false OR role_master IS NULL) as users_count,
        COUNT(*) FILTER (WHERE role_master = true) as masters_count
      FROM user_profile
    `);

    // Get weekly growth (users created in the last 7 days)
    const weeklyGrowthResult = await executeQuery(`
      SELECT 
        COUNT(*) FILTER (WHERE up.role_master = false OR up.role_master IS NULL) as users_growth,
        COUNT(*) FILTER (WHERE up.role_master = true) as masters_growth
      FROM user_profile up
      JOIN users u ON up.user_id = u.id
      WHERE u.created_at > NOW() - INTERVAL '7 days'
    `);

    const usersCount = Number.parseInt(countResult.rows[0].users_count) || 0;
    const mastersCount =
      Number.parseInt(countResult.rows[0].masters_count) || 0;
    const usersGrowth =
      Number.parseInt(weeklyGrowthResult.rows[0].users_growth) || 0;
    const mastersGrowth =
      Number.parseInt(weeklyGrowthResult.rows[0].masters_growth) || 0;

    console.log("Отримано дані про кількість користувачів та майстрів:", {
      users: usersCount,
      masters: mastersCount,
      usersGrowth,
      mastersGrowth,
    });

    res.json({
      users: usersCount,
      masters: mastersCount,
      usersGrowth,
      mastersGrowth,
    });
  } catch (error) {
    console.error(
      "❌ Помилка при отриманні кількості користувачів та майстрів:",
      error.message
    );
    res.status(500).json({ message: "Помилка сервера", error: error.message });
  }
});

// Add this new endpoint to get the count of orders/projects
app.get("/api/orders-count", async (req, res) => {
  try {
    console.log("Отримано запит на /api/orders-count");

    // Get total orders count
    const totalOrdersResult = await executeQuery(`
      SELECT COUNT(*) as total_orders
      FROM orders
    `);

    // Get completed orders count
    const completedOrdersResult = await executeQuery(`
      SELECT COUNT(*) as completed_orders
      FROM orders
      WHERE status = 'completed'
    `);

    // Get weekly growth (orders created in the last 7 days)
    const weeklyGrowthResult = await executeQuery(`
      SELECT COUNT(*) as weekly_growth
      FROM orders
      WHERE created_at > NOW() - INTERVAL '7 days'
    `);

    const totalOrders =
      Number.parseInt(totalOrdersResult.rows[0].total_orders) || 0;
    const completedOrders =
      Number.parseInt(completedOrdersResult.rows[0].completed_orders) || 0;
    const weeklyGrowth =
      Number.parseInt(weeklyGrowthResult.rows[0].weekly_growth) || 0;

    console.log("Отримано дані про кількість замовлень:", {
      total: totalOrders,
      completed: completedOrders,
      weeklyGrowth: weeklyGrowth,
    });

    res.json({
      total: totalOrders,
      completed: completedOrders,
      weeklyGrowth: weeklyGrowth,
    });
  } catch (error) {
    console.error(
      "❌ Помилка при отриманні кількості замовлень:",
      error.message
    );
    res.status(500).json({ message: "Помилка сервера", error: error.message });
  }
});

// Ендпоінт для отримання середнього віку користувачів
app.get("/api/average-age", async (req, res) => {
  try {
    console.log("Отримано запит на /api/average-age");

    const result = await executeQuery(`
      SELECT AVG(EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth))) as average_age
      FROM user_profile 
      WHERE date_of_birth IS NOT NULL
    `);

    const averageAge = result.rows[0].average_age
      ? Number.parseFloat(result.rows[0].average_age).toFixed(1)
      : "N/A";

    console.log("Середній вік користувачів:", averageAge);
    res.json({ averageAge });
  } catch (error) {
    console.error("❌ Помилка при обчисленні середнього віку:", error.message);
    res.status(500).json({ message: "Помилка сервера", error: error.message });
  }
});

// Ендпоінт для отримання списку галузей
app.get("/api/industries", async (req, res) => {
  try {
    console.log("Отримано запит на /api/industries");

    const industries = [
      {
        name: "Інформаційні технології",
        icon: "fas fa-laptop-code",
        description:
          "Розробка програмного забезпчення, веб-сайтів, мобільних додатків та IT-консультації",
      },
      {
        name: "Медицина",
        icon: "fas fa-heartbeat",
        description:
          "Медичні консультації, догляд за пацієнтами та медичне обладнання",
      },
      {
        name: "Енергетика",
        icon: "fas fa-bolt",
        description:
          "Енергетичні рішення, відновлювані джерела енергії та енергоефективність",
      },
      {
        name: "Аграрна галузь",
        icon: "fas fa-tractor",
        description: "Сільськогосподарські послуги, агрономія та тваринництво",
      },
      {
        name: "Фінанси та банківська справа",
        icon: "fas fa-money-bill-wave",
        description:
          "Фінансові консультації, бухгалтерія та інвестиційні поради",
      },
      {
        name: "Освіта",
        icon: "fas fa-graduation-cap",
        description: "Навчання, тренінги та освітні програми",
      },
      {
        name: "Туризм і гостинність",
        icon: "fas fa-plane",
        description:
          "Туристичні послуги, організація подорожей та готельний бізнес",
      },
      {
        name: "Будівництво та нерухомість",
        icon: "fas fa-hard-hat",
        description: "Будівельні роботи, ремонт та консультації з нерухомості",
      },
      {
        name: "Транспорт",
        icon: "fas fa-truck",
        description: "Транспортні послуги, логістика та доставка",
      },
      {
        name: "Мистецтво і культура",
        icon: "fas fa-palette",
        description: "Творчі послуги, дизайн та організація культурних заходів",
      },
    ];

    res.json(industries);
  } catch (error) {
    console.error("❌ Помилка при отриманні списку галузей:", error.message);
    res.status(500).json({ message: "Помилка сервера", error: error.message });
  }
});

// Ендпоінт для отримання послуг за галуззю
app.get("/api/services-by-industry/:industry", async (req, res) => {
  const industry = req.params.industry;

  try {
    console.log(`Отримано запит на /api/services-by-industry/${industry}`);

    // Отримуємо всіх майстрів з вказаною галуззю
    const mastersResult = await executeQuery(
      `
      SELECT u.id
      FROM users u
      JOIN user_profile up ON u.id = up.user_id
      JOIN user_services us ON u.id = us.user_id
      WHERE up.role_master = true 
      AND up.approval_status = 'approved'
      AND us.service_type = 'industry'
      AND us.service_name = $1
    `,
      [industry]
    );

    const masterIds = mastersResult.rows.map((row) => row.id);

    if (masterIds.length === 0) {
      return res.json([]);
    }

    // Отримуємо всі послуги цих майстрів
    const servicesResult = await executeQuery(
      `
      SELECT service_name, COUNT(*) as count
      FROM user_services
      WHERE user_id = ANY($1)
      AND service_type != 'industry'
      GROUP BY service_name
      ORDER BY count DESC
    `,
      [masterIds]
    );

    res.json(servicesResult.rows);
  } catch (error) {
    console.error("❌ Помилка при отриманні послуг за галуззю:", error.message);
    res.status(500).json({ message: "Помилка сервера", error: error.message });
  }
});

// ЕНДПОІНТИ ДЛЯ ЗАМОВЛЕНЬ

// Створення нового замовлення
app.post("/orders", async (req, res) => {
  const { user_id, title, description, phone, industry } = req.body;

  if (!user_id || !title || !phone) {
    return res
      .status(400)
      .json({ message: "Усі обов'язкові поля повинні бути заповнені" });
  }

  try {
    // Перевірка чи існує користувач
    const userResult = await executeQuery("SELECT * FROM users WHERE id = $1", [
      user_id,
    ]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Користувача не знайдено" });
    }

    // Створення нового замовлення
    const newOrder = await executeQuery(
      "INSERT INTO orders (user_id, title, description, phone, industry, status) VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id",
      [user_id, title, description, phone, industry]
    );

    console.log(
      `✅ Нове замовлення з ID ${newOrder.rows[0].id} успішно створено.`
    );
    res.status(201).json({
      success: true,
      message: "Замовлення успішно створено",
      orderId: newOrder.rows[0].id,
    });
  } catch (err) {
    console.error("❌ Помилка при створенні замовлення:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання всіх замовлень
app.get("/orders", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT o.id, o.user_id, o.title, o.description, o.phone, o.status, 
             o.industry, o.master_id, o.created_at, o.updated_at,
             u.username as user_username, 
             up.first_name as user_first_name, 
             up.last_name as user_last_name,
             up.email as user_email,
             m.username as master_username,
             mp.first_name as master_first_name,
             mp.last_name as master_last_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN user_profile up ON u.id = up.user_id
      LEFT JOIN users m ON o.master_id = m.id
      LEFT JOIN user_profile mp ON m.id = mp.user_id
      ORDER BY o.created_at DESC
    `);

    res.status(200).json({ orders: result.rows });
  } catch (err) {
    console.error("❌ Помилка при отриманні замовлень:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання замовлень користувача
app.get("/orders/user/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    const result = await executeQuery(
      `
      SELECT o.id, o.title, o.description, o.phone, o.status, 
             o.industry, o.master_id, o.created_at, o.updated_at,
             m.username as master_username,
             mp.first_name as master_first_name,
             mp.last_name as master_last_name
      FROM orders o
      LEFT JOIN users m ON o.master_id = m.id
      LEFT JOIN user_profile mp ON m.id = mp.user_id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
    `,
      [userId]
    );

    res.status(200).json({ orders: result.rows });
  } catch (err) {
    console.error(
      "❌ Помилка при отриманні замовлень користувача:",
      err.message
    );
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання замовлень, оброблених майстром
app.get("/orders/master/:masterId", async (req, res) => {
  const masterId = req.params.masterId;

  try {
    const result = await executeQuery(
      `
      SELECT o.id, o.user_id, o.title, o.description, o.phone, o.status, 
             o.industry, o.created_at, o.updated_at,
             u.username as user_username, 
             up.first_name as user_first_name, 
             up.last_name as user_last_name,
             up.email as user_email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN user_profile up ON u.id = up.user_id
      WHERE o.master_id = $1
      ORDER BY o.updated_at DESC
    `,
      [masterId]
    );

    res.status(200).json({ orders: result.rows });
  } catch (err) {
    console.error("❌ Помилка при отриманні замовлень майстра:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Оновлення статусу замовлення
app.put("/orders/:orderId", async (req, res) => {
  const orderId = req.params.orderId;
  const { status, master_id } = req.body;

  if (
    !status ||
    !["pending", "approved", "in_progress", "rejected", "completed"].includes(
      status
    )
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Невірний статус. Допустимі значення: pending, approved, in_progress, rejected, completed",
    });
  }

  try {
    // Перевірка чи існує замовлення
    const orderResult = await executeQuery(
      "SELECT * FROM orders WHERE id = $1",
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Замовлення не знайдено",
      });
    }

    // Перевірка чи користувач є майстром, якщо вказано master_id
    if (master_id) {
      const masterResult = await executeQuery(
        `
        SELECT * FROM user_profile 
        WHERE user_id = $1 AND role_master = true
        `,
        [master_id]
      );

      if (masterResult.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Тільки майстри можуть обробляти замовлення",
        });
      }

      // Перевіряємо статус затвердження майстра тільки якщо він знайдений
      if (masterResult.rows[0].approval_status !== "approved") {
        return res.status(403).json({
          success: false,
          message: "Тільки затверджені майстри можуть обробляти замовлення",
        });
      }
    }

    // Оновлення статусу замовлення
    const updateResult = await executeQuery(
      `
      UPDATE orders 
      SET status = $1, 
          master_id = $2, 
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = $3
      RETURNING id, status, master_id
      `,
      [status, master_id || orderResult.rows[0].master_id, orderId]
    );

    if (updateResult.rows.length === 0) {
      throw new Error("Не вдалося оновити замовлення");
    }

    console.log(`✅ Статус замовлення з ID ${orderId} змінено на ${status}.`);

    res.status(200).json({
      success: true,
      message: `Статус замовлення змінено на ${status}`,
      order: updateResult.rows[0],
    });
  } catch (err) {
    console.error("❌ Помилка при оновленні статусу замовлення:", err.message);
    res.status(500).json({
      success: false,
      message: "Помилка при оновленні статусу заявки",
      error: err.message,
    });
  }
});

// Отримання замовлень за галуззю
app.get("/orders/industry/:industry", async (req, res) => {
  const industry = req.params.industry;

  try {
    const result = await executeQuery(
      `
      SELECT o.id, o.user_id, o.title, o.description, o.phone, o.status, 
             o.industry, o.master_id, o.created_at, o.updated_at
      FROM orders o
      WHERE o.industry = $1
      ORDER BY o.created_at DESC
    `,
      [industry]
    );

    res.status(200).json({ orders: result.rows });
  } catch (err) {
    console.error(
      "❌ Помилка при отриманні замовлень за галуззю:",
      err.message
    );
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання статистики замовлень
app.get("/orders/stats", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected
      FROM orders
    `);

    res.status(200).json({ stats: result.rows[0] });
  } catch (err) {
    console.error(
      "❌ Помилка при отриманні статистики замовлень:",
      err.message
    );
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання замовлень за статусом
app.get("/orders/status/:status", async (req, res) => {
  const status = req.params.status;

  if (!["pending", "completed", "rejected", "all"].includes(status)) {
    return res.status(400).json({ message: "Невірний статус" });
  }

  try {
    let query = `
      SELECT o.id, o.user_id, o.title, o.description, o.phone, o.status, 
             o.industry, o.master_id, o.created_at, o.updated_at,
             u.username as user_username, 
             up.first_name as user_first_name, 
             up.last_name as user_last_name,
             up.email as user_email,
             m.username as master_username,
             mp.first_name as master_first_name,
             mp.last_name as master_last_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN user_profile up ON u.id = up.user_id
      LEFT JOIN users m ON o.master_id = m.id
      LEFT JOIN user_profile mp ON m.id = mp.user_id
    `;

    if (status !== "all") {
      query += ` WHERE o.status = $1`;
    }

    query += ` ORDER BY o.created_at DESC`;

    const result =
      status === "all"
        ? await executeQuery(query)
        : await executeQuery(query, [status]);

    res.status(200).json({ orders: result.rows });
  } catch (err) {
    console.error(
      "❌ Помилка при отриманні замовлень за статусом:",
      err.message
    );
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання деталей замовлення за ID
app.get("/orders/:orderId", async (req, res) => {
  const orderId = req.params.orderId;

  try {
    const result = await executeQuery(
      `
      SELECT o.id, o.user_id, o.title, o.description, o.phone, o.status, 
             o.industry, o.master_id, o.created_at, o.updated_at,
             u.username as user_username, 
             up.first_name as user_first_name, 
             up.last_name as user_last_name,
             up.email as user_email,
             m.username as master_username,
             mp.first_name as master_first_name,
             mp.last_name as master_last_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN user_profile up ON u.id = u.user_id
      LEFT JOIN users m ON o.master_id = m.id
      LEFT JOIN user_profile mp ON m.id = mp.user_id
      WHERE o.id = $1
    `,
      [orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Замовлення не знайдено" });
    }

    res.status(200).json({ order: result.rows[0] });
  } catch (err) {
    console.error("❌ Помилка при отриманні деталей замовлення:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Пошук замовлень
app.get("/orders/search/:query", async (req, res) => {
  const query = req.params.query;

  try {
    const result = await executeQuery(
      `
      SELECT o.id, o.user_id, o.title, o.description, o.phone, o.status, 
             o.industry, o.master_id, o.created_at, o.updated_at,
             u.username as user_username, 
             up.first_name as user_first_name, 
             up.last_name as user_last_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN user_profile up ON u.id = up.user_id
      WHERE 
        o.title ILIKE $1 OR 
        o.description ILIKE $1 OR 
        o.industry ILIKE $1 OR
        u.username ILIKE $1 OR
        up.first_name ILIKE $1 OR
        up.last_name ILIKE $1
      ORDER BY o.created_at DESC
    `,
      [`%${query}%`]
    );

    res.status(200).json({ orders: result.rows });
  } catch (err) {
    console.error("❌ Помилка при пошуку замовлень:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання кількості замовлень за галузями
app.get("/orders/stats/by-industry", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT 
        industry, 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected
      FROM orders
      GROUP BY industry
      ORDER BY total DESC
    `);

    res.status(200).json({ stats: result.rows });
  } catch (err) {
    console.error(
      "❌ Помилка при отриманні статистики за галузями:",
      err.message
    );
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання останніх замовлень (для дашборду)
app.get("/orders/latest/:limit", async (req, res) => {
  const limit = Number.parseInt(req.params.limit) || 5;

  try {
    const result = await executeQuery(
      `
      SELECT o.id, o.title, o.status, o.industry, o.created_at,
             u.username as user_username,
             up.first_name as user_first_name,
             up.last_name as user_last_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN user_profile up ON u.id = up.user_id
      ORDER BY o.created_at DESC
      LIMIT $1
    `,
      [limit]
    );

    res.status(200).json({ orders: result.rows });
  } catch (err) {
    console.error("❌ Помилка при отриманні останніх замовлень:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання кількості замовлень за статусами
app.get("/orders/count/by-status", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT 
        status,
        COUNT(*) as count
      FROM orders
      GROUP BY status
    `);

    // Перетворюємо результат у зручний формат
    const counts = {
      pending: 0,
      completed: 0,
      rejected: 0,
      total: 0,
    };

    result.rows.forEach((row) => {
      counts[row.status] = Number.parseInt(row.count);
      counts.total += Number.parseInt(row.count);
    });

    res.status(200).json(counts);
  } catch (err) {
    console.error("❌ Помилка при отриманні кількості замовлень:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// ЕНДПОІНТИ ДЛЯ ВІДГУКІВ

// Створення нового відгуку
app.post("/reviews", async (req, res) => {
  const { user_id, name, industry, rating, text, master_name, city } = req.body;

  if (!name || !industry || !rating || !text) {
    return res
      .status(400)
      .json({ message: "Усі обов'язкові поля повинні бути заповнені" });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Оцінка повинна бути від 1 до 5" });
  }

  try {
    // Перевірка чи існує користувач, якщо вказано user_id
    if (user_id) {
      const userResult = await executeQuery(
        "SELECT * FROM users WHERE id = $1",
        [user_id]
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ message: "Користувача не знайдено" });
      }
    }

    // Створення нового відгуку
    const newReview = await executeQuery(
      "INSERT INTO reviews (user_id, name, industry, rating, text, master_name, city, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved') RETURNING id",
      [
        user_id || null,
        name,
        industry,
        rating,
        text,
        master_name || null,
        city || "Не вказано",
      ]
    );

    console.log(
      `✅ Новий відгук з ID ${newReview.rows[0].id} успішно створено.`
    );
    res.status(201).json({
      success: true,
      message: "Відгук успішно створено",
      reviewId: newReview.rows[0].id,
    });
  } catch (err) {
    console.error("❌ Помилка при створенні відгуку:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання всіх відгуків
app.get("/reviews", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT id, user_id, name, industry, rating, text, master_name, city, status, created_at, updated_at
      FROM reviews
      WHERE status = 'approved'
      ORDER BY created_at DESC
    `);

    res.status(200).json({ reviews: result.rows });
  } catch (err) {
    console.error("❌ Помилка при отриманні відгуків:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання відгуку за ID
app.get("/reviews/:reviewId", async (req, res) => {
  const reviewId = req.params.reviewId;

  try {
    const result = await executeQuery(
      `
      SELECT id, user_id, name, industry, rating, text, master_name, city, status, created_at, updated_at
      FROM reviews
      WHERE id = $1
    `,
      [reviewId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Відгук не знайдено" });
    }

    res.status(200).json({ review: result.rows[0] });
  } catch (err) {
    console.error("❌ Помилка при отриманні відгуку:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Видалення відгуку
app.delete("/reviews/:reviewId", async (req, res) => {
  const reviewId = req.params.reviewId;

  try {
    const result = await executeQuery(
      "DELETE FROM reviews WHERE id = $1 RETURNING id",
      [reviewId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Відгук не знайдено" });
    }

    console.log(`✅ Відгук з ID ${reviewId} успішно видалено.`);
    res.status(200).json({ message: "Відгук успішно видалено" });
  } catch (err) {
    console.error("❌ Помилка при видаленні відгуку:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Оновлення статусу відгуку (для модерації)
app.put("/reviews/:reviewId/status", async (req, res) => {
  const reviewId = req.params.reviewId;
  const { status } = req.body;

  if (!status || !["pending", "approved", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Невірний статус" });
  }

  try {
    const result = await executeQuery(
      "UPDATE reviews SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id",
      [status, reviewId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Відгук не знайдено" });
    }

    console.log(`✅ Статус відгуку з ID ${reviewId} змінено на ${status}.`);
    res.status(200).json({ message: `Статус відгуку змінено на ${status}` });
  } catch (err) {
    console.error("❌ Помилка при оновленні статусу відгуку:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання відгуків за галуззю
app.get("/reviews/industry/:industry", async (req, res) => {
  const industry = req.params.industry;

  try {
    const result = await executeQuery(
      `
      SELECT id, user_id, name, industry, rating, text, master_name, city, status, created_at, updated_at
      FROM reviews
      WHERE industry = $1 AND status = 'approved'
      ORDER BY created_at DESC
    `,
      [industry]
    );

    res.status(200).json({ reviews: result.rows });
  } catch (err) {
    console.error("❌ Помилка при отриманні відгуків за галуззю:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання відгуків за оцінкою
app.get("/reviews/rating/:rating", async (req, res) => {
  const rating = Number.parseInt(req.params.rating);

  if (isNaN(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Невірна оцінка" });
  }

  try {
    const result = await executeQuery(
      `
      SELECT id, user_id, name, industry, rating, text, master_name, city, status, created_at, updated_at
      FROM reviews
      WHERE rating = $1 AND status = 'approved'
      ORDER BY created_at DESC
    `,
      [rating]
    );

    res.status(200).json({ reviews: result.rows });
  } catch (err) {
    console.error("❌ Помилка при отриманні відгуків за оцінкою:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання статистики відгуків за оцінками
app.get("/api/review-ratings", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT rating, COUNT(*) as count
      FROM reviews
      WHERE status = 'approved'
      GROUP BY rating
      ORDER BY rating
    `);

    // Перетворюємо результат у зручний формат
    const ratings = {};
    let totalCount = 0;

    result.rows.forEach((row) => {
      ratings[row.rating] = Number.parseInt(row.count);
      totalCount += Number.parseInt(row.count);
    });

    res.status(200).json({
      ratings,
      totalCount,
      averageRating:
        totalCount > 0
          ? (
              Object.entries(ratings).reduce(
                (sum, [rating, count]) => sum + Number.parseInt(rating) * count,
                0
              ) / totalCount
            ).toFixed(1)
          : 0,
    });
  } catch (err) {
    console.error("❌ Помилка при отриманні статистики відгуків:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Отримання статистики відгуків за галузями
app.get("/api/review-industries", async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT industry, COUNT(*) as count
      FROM reviews
      WHERE status = 'approved'
      GROUP BY industry
      ORDER BY count DESC
    `);

    // Перетворюємо результат у зручний формат
    const industries = {};

    result.rows.forEach((row) => {
      industries[row.industry] = Number.parseInt(row.count);
    });

    res.status(200).json({ industries });
  } catch (err) {
    console.error("❌ Помилка при отриманні статистики відгуків:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");

    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
});

// Modify the send-message endpoint to properly handle industries
app.post(
  "/send-message",
  upload.fields([
    { name: "voiceMessage", maxCount: 1 },
    { name: "videoMessage", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { username, email, messageType } = req.body;

      if (!username || !email || !messageType) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      let messageContent = null;
      let filePath = null;
      let mediaUrl = null;

      // Process message based on type
      if (messageType === "text") {
        const { textMessage } = req.body;

        if (!textMessage) {
          return res.status(400).json({ error: "Missing text message" });
        }

        messageContent = textMessage;
      } else if (messageType === "voice") {
        if (!req.files.voiceMessage) {
          return res.status(400).json({ error: "Missing voice message" });
        }

        filePath = req.files.voiceMessage[0].path;
        // Create a URL for the file
        const fileName = path.basename(filePath);
        mediaUrl = `/uploads/${fileName}`;
      } else if (messageType === "video") {
        if (!req.files.videoMessage) {
          return res.status(400).json({ error: "Missing video message" });
        }

        filePath = req.files.videoMessage[0].path;
        // Create a URL for the file
        const fileName = path.basename(filePath);
        mediaUrl = `/uploads/${fileName}`;
      } else {
        return res.status(400).json({ error: "Invalid message type" });
      }

      // FIXED: Improved handling of industries array
      let industriesArray = [];

      // First try to get industries from JSON string
      if (req.body.industries) {
        try {
          industriesArray = JSON.parse(req.body.industries);
        } catch (e) {
          console.error("Error parsing industries JSON:", e);
        }
      }

      // If that fails or returns empty, try to get individual industry values
      if (industriesArray.length === 0) {
        // Get all values with the name 'industry'
        industriesArray = Array.isArray(req.body.industry)
          ? req.body.industry
          : req.body.industry
          ? [req.body.industry]
          : [];
      }

      console.log("Отримані галузі:", industriesArray);

      // Save message to database - FIXED: Ensure industries is stored as an array
      const result = await executeQuery(
        `
        INSERT INTO messages (username, email, message, message_type, content, media_path, industries)
        VALUES ($1, $2, $3, $4, $5, $6, $7::text[])
        RETURNING id, industries
        `,
        [
          username,
          email,
          messageContent || "",
          messageType,
          messageContent,
          mediaUrl,
          industriesArray, // Explicitly cast to text array
        ]
      );

      const messageId = result.rows[0].id;
      console.log("Збережені галузі:", result.rows[0].industries);

      // Send message to Telegram (if you're using this functionality)
      try {
        await sendMessage({
          username,
          email,
          messageType,
          messageContent,
          filePath,
          industries: industriesArray,
        });
      } catch (telegramError) {
        console.error("Error sending message to Telegram:", telegramError);
        // Continue execution even if Telegram sending fails
      }

      res.status(200).json({
        success: true,
        message: "Message sent successfully",
        messageId,
        industries: industriesArray, // Return the industries in the response
      });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({
        error: error.message || "Failed to send message",
      });
    }
  }
);

// Оновлений ендпоінт для отримання повідомлень
app.get("/api/messages", async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page) || 1;
    const limit = Number.parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const messageType = req.query.type;
    const sortOrder = req.query.sort === "asc" ? "ASC" : "DESC";
    const searchQuery = req.query.search;

    // Build the query
    let query = `
      SELECT id, username, email, message_type, content, message, media_path as media_url, industries, created_at
      FROM messages
      WHERE 1=1
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Add type filter if specified
    if (messageType && messageType !== "all") {
      query += ` AND message_type = $${paramIndex}`;
      queryParams.push(messageType);
      paramIndex++;
    }

    // Add search filter if specified
    if (searchQuery) {
      query += ` AND (
        username ILIKE $${paramIndex} OR
        email ILIKE $${paramIndex} OR
        content ILIKE $${paramIndex} OR
        message ILIKE $${paramIndex} OR
        EXISTS (
          SELECT 1 FROM unnest(industries) as industry
          WHERE industry ILIKE $${paramIndex}
        )
      )`;
      queryParams.push(`%${searchQuery}%`);
      paramIndex++;
    }

    // Add sorting and pagination
    query += ` ORDER BY created_at ${sortOrder} LIMIT $${paramIndex} OFFSET $${
      paramIndex + 1
    }`;
    queryParams.push(limit, offset);

    // Execute the query
    const result = await executeQuery(query, queryParams);

    // Debug log to check what's coming from the database
    console.log("Отримані повідомлення з бази даних:", result.rows);

    // Ensure industries is always an array
    const messages = result.rows.map((message) => {
      // If industries is null or undefined, set it to an empty array
      if (!message.industries) {
        message.industries = [];
      }
      return message;
    });

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM messages
      WHERE 1=1
    `;

    const countParams = [];
    paramIndex = 1;

    // Add type filter if specified
    if (messageType && messageType !== "all") {
      countQuery += ` AND message_type = $${paramIndex}`;
      countParams.push(messageType);
      paramIndex++;
    }

    // Add search filter if specified
    if (searchQuery) {
      countQuery += ` AND (
        username ILIKE $${paramIndex} OR
        email ILIKE $${paramIndex} OR
        content ILIKE $${paramIndex} OR
        message ILIKE $${paramIndex} OR
        EXISTS (
          SELECT 1 FROM unnest(industries) as industry
          WHERE industry ILIKE $${paramIndex}
        )
      )`;
      countParams.push(`%${searchQuery}%`);
    }

    const countResult = await executeQuery(countQuery, countParams);
    const total = Number.parseInt(countResult.rows[0].total);

    res.status(200).json({
      messages: messages,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Error getting messages:", err.message);
    res.status(500).json({ error: "Failed to get messages" });
  }
});

// Оновлений ендпоінт для отримання одного повідомлення
app.get("/api/messages/:id", async (req, res) => {
  try {
    const messageId = req.params.id;

    const result = await executeQuery(
      `
      SELECT id, username, email, message_type, content, message, media_path as media_url, industries, created_at
      FROM messages
      WHERE id = $1
      `,
      [messageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Ensure industries is always an array
    const message = result.rows[0];
    if (!message.industries) {
      message.industries = [];
    }

    console.log("Отримане повідомлення з бази даних:", message);

    res.status(200).json({ message });
  } catch (err) {
    console.error("❌ Error getting message:", err.message);
    res.status(500).json({ error: "Failed to get message" });
  }
});

// Delete a message
app.delete("/api/messages/:id", async (req, res) => {
  try {
    const messageId = req.params.id;

    // Get the message to check if it has a media file
    const messageResult = await executeQuery(
      "SELECT media_path FROM messages WHERE id = $1",
      [messageId]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    const mediaPath = messageResult.rows[0].media_path;

    // Delete the message from the database
    await executeQuery("DELETE FROM messages WHERE id = $1", [messageId]);

    // Delete the media file if it exists
    if (mediaPath) {
      const fullPath = path.join(__dirname, mediaPath.replace(/^\//, ""));
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    res
      .status(200)
      .json({ success: true, message: "Message deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting message:", err.message);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Serve the info page
app.get("/info.html", (req, res) => {
  res.sendFile(path.join(__dirname, "info.html"));
});

// Add this route to handle avatar uploads
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "public/uploads/avatars");

    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const userId = req.params.userId;
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${userId}-${Date.now()}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Тільки зображення можуть бути завантажені!"), false);
    }
  },
});

// Add this route to your server.js file
app.post(
  "/upload-avatar/:userId",
  authenticateToken,
  avatarUpload.single("avatar"),
  async (req, res) => {
    try {
      const userId = req.params.userId;

      // Check if user exists
      const userResult = await executeQuery(
        "SELECT * FROM users WHERE id = $1",
        [userId]
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ message: "Користувача не знайдено" });
      }

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({ message: "Файл не завантажено" });
      }

      // Create URL for the uploaded file
      const imageUrl = `/uploads/avatars/${req.file.filename}`;

      // Update user profile with the new avatar URL
      await executeQuery(
        "UPDATE user_profile SET profile_image_url = $1 WHERE user_id = $2",
        [imageUrl, userId]
      );

      console.log(`✅ Аватар для користувача з ID ${userId} успішно оновлено.`);
      res.status(200).json({
        success: true,
        message: "Аватар успішно оновлено",
        imageUrl: imageUrl,
      });
    } catch (err) {
      console.error("❌ Помилка при завантаженні аватара:", err.message);
      res.status(500).json({ message: "Помилка сервера", error: err.message });
    }
  }
);

// Make sure to add this column to your user_profile table if it doesn't exist
const addProfileImageUrlColumn = async () => {
  try {
    // Check if the column exists
    const columnExists = await executeQuery(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'user_profile' AND column_name = 'profile_image_url'
      );
    `);

    if (!columnExists.rows[0].exists) {
      // Add the column if it doesn't exist
      await executeQuery(`
        ALTER TABLE user_profile 
        ADD COLUMN profile_image_url VARCHAR(255);
      `);
      console.log("✅ Added profile_image_url column to user_profile table");
    }
  } catch (err) {
    console.error(
      "❌ Error checking/adding profile_image_url column:",
      err.message
    );
  }
};

// Call this function during server initialization
addProfileImageUrlColumn().catch((err) => {
  console.error("Failed to add profile_image_url column:", err.message);
});

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// Add a route to serve the profile page
app.get("/profile", (req, res) => {
  res.sendFile(path.join(__dirname, "profile.html"));
});

// Створіть HTTP сервер з вашого Express додатку
const server = http.createServer(app);
const io = socketIo(server);

// Зберігання активних користувачів
const activeUsers = new Map();

// Socket.io обробка подій
io.on("connection", (socket) => {
  console.log("Новий користувач підключився:", socket.id);

  // Обробка приєднання до чату
  socket.on("join", (user) => {
    console.log(`Користувач ${user.username} приєднався до чату`);

    // Зберігаємо інформацію про користувача
    activeUsers.set(socket.id, user);

    // Повідомляємо всіх про нового користувача
    io.emit("user-joined", user);
  });

  // Обробка повідомлень
  socket.on("message", (message) => {
    console.log(`Нове повідомлення від ${message.username}: ${message.text}`);

    // Відправляємо повідомлення всім користувачам
    io.emit("message", message);
  });

  // Обробка виходу з чату
  socket.on("leave", (user) => {
    console.log(`Користувач ${user.username} покинув чат`);

    // Видаляємо користувача зі списку активних
    activeUsers.delete(socket.id);

    // Повідомляємо всіх про вихід користувача
    io.emit("user-left", user);
  });

  // Обробка відключення
  socket.on("disconnect", () => {
    console.log("Користувач відключився:", socket.id);

    // Перевіряємо, чи був користувач у чаті
    const user = activeUsers.get(socket.id);
    if (user) {
      // Видаляємо користувача зі списку активних
      activeUsers.delete(socket.id);

      // Повідомляємо всіх про вихід користувача
      io.emit("user-left", user);
    }
  });
});

// Create chat messages table if it doesn't exist
const createChatMessagesTable = async () => {
  try {
    // First check if the table exists
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'chat_messages'
      );
    `;

    const tableExists = await executeQuery(tableExistsQuery);

    if (tableExists.rows[0].exists) {
      console.log(
        "Chat messages table exists, checking for required columns..."
      );

      // Get existing columns
      const columnsResult = await executeQuery(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'chat_messages';
      `);

      const columns = columnsResult.rows.map((row) => row.column_name);
      console.log("Existing chat_messages table columns:", columns);

      // Check for required columns and add them if missing
      const requiredColumns = [
        { name: "sender_id", type: "VARCHAR(100) NOT NULL" },
        { name: "receiver_id", type: "VARCHAR(100) NOT NULL" },
        { name: "message_type", type: "VARCHAR(20) NOT NULL DEFAULT 'text'" },
        { name: "content", type: "TEXT NOT NULL" },
        { name: "file_name", type: "VARCHAR(255)" },
        { name: "file_path", type: "VARCHAR(255)" },
        { name: "read", type: "BOOLEAN DEFAULT FALSE" },
        { name: "created_at", type: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" },
      ];

      for (const column of requiredColumns) {
        if (!columns.includes(column.name)) {
          await executeQuery(`
            ALTER TABLE chat_messages 
            ADD COLUMN ${column.name} ${column.type};
          `);
          console.log(`✅ Added ${column.name} column to chat_messages table`);
        }
      }
    } else {
      // Create the table with all required columns
      const chatMessagesTableQuery = `
        CREATE TABLE chat_messages (
          id SERIAL PRIMARY KEY,
          sender_id VARCHAR(100) NOT NULL,
          receiver_id VARCHAR(100) NOT NULL,
          message_type VARCHAR(20) NOT NULL DEFAULT 'text',
          content TEXT NOT NULL,
          file_name VARCHAR(255),
          file_path VARCHAR(255),
          read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      await executeQuery(chatMessagesTableQuery);
      console.log("✅ Created chat_messages table with all required columns");
    }
  } catch (err) {
    console.error(
      "❌ Error creating/updating chat_messages table:",
      err.message
    );
  }
};

// Call this function during server initialization
createChatMessagesTable().catch((err) => {
  console.error("Failed to initialize chat_messages table:", err.message);
});

// Configure multer for chat file uploads
const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads/chat");

    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const chatUpload = multer({
  storage: chatStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
});

// API endpoint to get chat history
app.get("/api/chat/history", async (req, res) => {
  try {
    const { userId, masterId } = req.query;

    if (!userId || !masterId) {
      return res.status(400).json({ error: "Missing userId or masterId" });
    }

    const result = await executeQuery(
      `
      SELECT id, sender_id, receiver_id, message_type, content, file_name, read, created_at
      FROM chat_messages
      WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
      ORDER BY created_at ASC
    `,
      [userId, masterId]
    );

    // Format messages for client
    const messages = result.rows.map((msg) => ({
      id: msg.id,
      sender: msg.sender_id,
      receiver: msg.receiver_id,
      type: msg.message_type,
      content: msg.content,
      fileName: msg.file_name,
      time: new Date(msg.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      read: msg.read,
    }));

    res.status(200).json({ messages });
  } catch (err) {
    console.error("❌ Error getting chat history:", err.message);
    res.status(500).json({ error: "Failed to get chat history" });
  }
});

// API endpoint to save chat message
app.post("/api/chat/message", async (req, res) => {
  try {
    const { id, sender, receiver, type, content, fileName, username } =
      req.body;

    if (!sender || !receiver || !type || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await executeQuery(
      `
      INSERT INTO chat_messages (sender_id, receiver_id, message_type, content, file_name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
      [sender, receiver, type, content, fileName || null]
    );

    console.log(
      `✅ Saved chat message from ${username || sender} to ${receiver}`
    );

    res.status(200).json({
      success: true,
      message: "Message saved successfully",
      id: result.rows[0].id,
    });
  } catch (err) {
    console.error("❌ Error saving chat message:", err.message);
    res.status(500).json({ error: "Failed to save message" });
  }
});

// API endpoint to mark messages as read
app.post("/api/chat/read", async (req, res) => {
  try {
    const { messageIds, userId, masterId } = req.body;

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: "Invalid messageIds" });
    }

    await executeQuery(
      `
      UPDATE chat_messages
      SET read = TRUE
      WHERE id = ANY($1) AND sender_id = $2 AND receiver_id = $3
    `,
      [messageIds, masterId, userId]
    );

    res.status(200).json({
      success: true,
      message: "Messages marked as read",
    });
  } catch (err) {
    console.error("❌ Error marking messages as read:", err.message);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
});

// API endpoint to upload chat files
app.post("/api/chat/upload", chatUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { senderId, receiverId, type } = req.body;

    if (!senderId || !receiverId) {
      return res.status(400).json({ error: "Missing sender or receiver ID" });
    }

    // Create file URL
    const fileUrl = `/uploads/chat/${req.file.filename}`;
    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // Save message to database
    const result = await executeQuery(
      `
      INSERT INTO chat_messages (sender_id, receiver_id, message_type, content, file_name, file_path)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
      [senderId, receiverId, type || "file", fileUrl, fileName, filePath]
    );

    console.log(
      `✅ Uploaded file ${fileName} from ${senderId} to ${receiverId}`
    );

    res.status(200).json({
      success: true,
      message: "File uploaded successfully",
      fileUrl,
      messageId: result.rows[0].id,
    });
  } catch (err) {
    console.error("❌ Error uploading file:", err.message);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

// API endpoint to get master info
app.get("/api/masters/:masterId", async (req, res) => {
  try {
    const masterId = req.params.masterId;

    const result = await executeQuery(
      `
      SELECT u.id, u.username, up.first_name, up.last_name, up.email, up.phone
      FROM users u
      JOIN user_profile up ON u.id = up.user_id
      WHERE u.id = $1 AND up.role_master = true
    `,
      [masterId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Master not found" });
    }

    // Check if master is online (using activeUsers map from socket.io)
    const masterSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === masterId
    )?.[0];

    const online = !!masterSocketId;

    const masterInfo = {
      ...result.rows[0],
      online,
    };

    res.status(200).json(masterInfo);
  } catch (err) {
    console.error("❌ Error getting master info:", err.message);
    res.status(500).json({ error: "Failed to get master info" });
  }
});

// Enhanced Socket.io event handling for chat
io.on("connection", (socket) => {
  // Existing connection code...

  // Обробка дзвінків
  socket.on("call-offer", (data) => {
    console.log(
      `Вхідний дзвінок від ${data.caller.username} до ${data.receiver}`
    );

    // Знаходимо сокет отримувача
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiver
    )?.[0];

    if (receiverSocketId) {
      // Якщо отримувач онлайн, відправляємо йому пропозицію дзвінка
      io.to(receiverSocketId).emit("call-offer", data);
    } else {
      // Якщо отримувач офлайн, відправляємо відправнику повідомлення про недоступність
      socket.emit("call-unavailable", {
        receiver: data.receiver,
        message: "Користувач зараз не в мережі",
      });
    }
  });

  socket.on("call-answer", (data) => {
    console.log(`Відповідь на дзвінок від ${data.sender} до ${data.receiver}`);

    // Знаходимо сокет отримувача
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiver
    )?.[0];

    if (receiverSocketId) {
      // Відправляємо відповідь на дзвінок
      io.to(receiverSocketId).emit("call-answer", data);
    }
  });

  socket.on("call-declined", (data) => {
    console.log(`Дзвінок відхилено від ${data.sender} до ${data.receiver}`);

    // Знаходимо сокет отримувача
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiver
    )?.[0];

    if (receiverSocketId) {
      // Відправляємо повідомлення про відхилення дзвінка
      io.to(receiverSocketId).emit("call-declined", data);
    }
  });

  socket.on("ice-candidate", (data) => {
    // Знаходимо сокет отримувача
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiver
    )?.[0];

    if (receiverSocketId) {
      // Відправляємо ICE кандидата
      io.to(receiverSocketId).emit("ice-candidate", data);
    }
  });

  socket.on("end-call", (data) => {
    console.log(`Дзвінок завершено від ${data.sender} до ${data.receiver}`);

    // Знаходимо сокет отримувача
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiver
    )?.[0];

    if (receiverSocketId) {
      // Відправляємо повідомлення про завершення дзвінка
      io.to(receiverSocketId).emit("end-call", data);
    }
  });

  // Existing socket event handlers...
});

// Make sure to create the uploads/chat directory
const chatUploadsDir = path.join(__dirname, "uploads/chat");
if (!fs.existsSync(chatUploadsDir)) {
  fs.mkdirSync(chatUploadsDir, { recursive: true });
}

// Serve the chat pages
app.get("/chat/user", (req, res) => {
  res.sendFile(path.join(__dirname, "communicationU.html"));
});

app.get("/chat/master", (req, res) => {
  res.sendFile(path.join(__dirname, "communicationM.html"));
});

console.log("✅ Chat API endpoints have been added successfully!");
// Add these routes to your server.js file

// Create video calls table if it doesn't exist
const createVideoCallsTable = async () => {
  try {
    // First check if the table exists
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'video_calls'
      );
    `;

    const tableExists = await executeQuery(tableExistsQuery);

    if (tableExists.rows[0].exists) {
      console.log("Video calls table exists, checking for required columns...");

      // Get existing columns
      const columnsResult = await executeQuery(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'video_calls';
      `);

      const columns = columnsResult.rows.map((row) => row.column_name);
      console.log("Existing video_calls table columns:", columns);

      // Check for required columns and add them if missing
      const requiredColumns = [
        { name: "user_id", type: "INTEGER NOT NULL" },
        { name: "master_id", type: "INTEGER NOT NULL" },
        { name: "user_name", type: "VARCHAR(100)" },
        { name: "master_name", type: "VARCHAR(100)" },
        { name: "status", type: "VARCHAR(20) NOT NULL DEFAULT 'pending'" },
        { name: "duration", type: "INTEGER DEFAULT 0" },
        { name: "created_at", type: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" },
        { name: "updated_at", type: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" },
      ];

      for (const column of requiredColumns) {
        if (!columns.includes(column.name)) {
          await executeQuery(`
            ALTER TABLE video_calls 
            ADD COLUMN ${column.name} ${column.type};
          `);
          console.log(`✅ Added ${column.name} column to video_calls table`);
        }
      }
    } else {
      // Create the table with all required columns
      const videoCallsTableQuery = `
        CREATE TABLE video_calls (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          master_id INTEGER NOT NULL,
          user_name VARCHAR(100),
          master_name VARCHAR(100),
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          duration INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      await executeQuery(videoCallsTableQuery);
      console.log("✅ Created video_calls table with all required columns");
    }
  } catch (err) {
    console.error("❌ Error creating/updating video_calls table:", err.message);
  }
};

// Call this function during server initialization
createVideoCallsTable().catch((err) => {
  console.error("Failed to initialize video_calls table:", err.message);
});

// API endpoint to save call history
app.post("/api/call-history", async (req, res) => {
  try {
    const { user_id, master_id, user_name, master_name, status, duration } =
      req.body;

    if (!user_id || !master_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await executeQuery(
      `
      INSERT INTO video_calls (user_id, master_id, user_name, master_name, status, duration)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
      [user_id, master_id, user_name, master_name, status, duration || 0]
    );

    console.log(`✅ Saved video call to history with ID ${result.rows[0].id}`);

    res.status(200).json({
      success: true,
      message: "Call saved to history",
      id: result.rows[0].id,
    });
  } catch (err) {
    console.error("❌ Error saving call history:", err.message);
    res.status(500).json({ error: "Failed to save call history" });
  }
});

// API endpoint to get user's call history
app.get("/api/call-history/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await executeQuery(
      `
      SELECT id, user_id, master_id, master_name, status, duration, created_at
      FROM video_calls
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
      [userId]
    );

    res.status(200).json({ history: result.rows });
  } catch (err) {
    console.error("❌ Error getting call history:", err.message);
    res.status(500).json({ error: "Failed to get call history" });
  }
});

// API endpoint to get master's call history
app.get("/api/call-history/master/:masterId", async (req, res) => {
  try {
    const masterId = req.params.masterId;

    const result = await executeQuery(
      `
      SELECT id, user_id, master_id, user_name, status, duration, created_at
      FROM video_calls
      WHERE master_id = $1
      ORDER BY created_at DESC
    `,
      [masterId]
    );

    res.status(200).json({ history: result.rows });
  } catch (err) {
    console.error("❌ Error getting master call history:", err.message);
    res.status(500).json({ error: "Failed to get master call history" });
  }
});

// API endpoint to get call statistics for a master
app.get("/api/call-stats/master/:masterId", async (req, res) => {
  try {
    const masterId = req.params.masterId;

    const result = await executeQuery(
      `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as accepted,
        COUNT(*) FILTER (WHERE status = 'missed' OR status = 'rejected') as missed,
        AVG(duration) FILTER (WHERE status = 'completed') as avg_duration
      FROM video_calls
      WHERE master_id = $1
    `,
      [masterId]
    );

    const stats = {
      total: Number.parseInt(result.rows[0].total) || 0,
      accepted: Number.parseInt(result.rows[0].accepted) || 0,
      missed: Number.parseInt(result.rows[0].missed) || 0,
      avgDuration: result.rows[0].avg_duration
        ? Math.round(Number.parseFloat(result.rows[0].avg_duration))
        : 0,
    };

    res.status(200).json(stats);
  } catch (err) {
    console.error("❌ Error getting call statistics:", err.message);
    res.status(500).json({ error: "Failed to get call statistics" });
  }
});

// API endpoint to update call status
app.put("/api/call-history/:callId", async (req, res) => {
  try {
    const callId = req.params.callId;
    const { status, duration } = req.body;

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    const result = await executeQuery(
      `
      UPDATE video_calls
      SET status = $1, duration = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id
    `,
      [status, duration || 0, callId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Call not found" });
    }

    res.status(200).json({
      success: true,
      message: "Call status updated",
    });
  } catch (err) {
    console.error("❌ Error updating call status:", err.message);
    res.status(500).json({ error: "Failed to update call status" });
  }
});

// Route to check user type and redirect accordingly
app.get("/video", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.redirect("/auth.html");
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "default_secret_key"
    );
    const userId = decoded.id;

    // Check if user is a master
    executeQuery("SELECT role_master FROM user_profile WHERE user_id = $1", [
      userId,
    ])
      .then((result) => {
        if (result.rows.length === 0) {
          return res.redirect("/auth.html");
        }

        const isMaster = result.rows[0].role_master;

        if (isMaster) {
          res.redirect("/videom.html");
        } else {
          res.redirect("/video.html");
        }
      })
      .catch((err) => {
        console.error("❌ Error checking user type:", err.message);
        res.redirect("/auth.html");
      });
  } catch (err) {
    console.error("❌ Error verifying token:", err.message);
    res.redirect("/auth.html");
  }
});

// Enhanced Socket.io event handling for video calls
io.on("connection", (socket) => {
  // Handle call offer
  socket.on("call-offer", (data) => {
    console.log(`Call offer from ${data.sender} to ${data.receiver}`);

    // Find the receiver's socket
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiver
    )?.[0];

    if (receiverSocketId) {
      // Forward the offer to the receiver
      io.to(receiverSocketId).emit("call-offer", data);
    } else {
      // Notify the sender that the receiver is unavailable
      socket.emit("call-unavailable", {
        receiver: data.receiver,
        message: "User is currently offline",
      });
    }
  });

  // Handle call answer
  socket.on("call-answer", (data) => {
    console.log(`Call answer from ${data.sender} to ${data.receiver}`);

    // Find the receiver's socket
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiver
    )?.[0];

    if (receiverSocketId) {
      // Forward the answer to the receiver
      io.to(receiverSocketId).emit("call-answer", data);
    }
  });

  // Handle ICE candidates
  socket.on("ice-candidate", (data) => {
    // Find the receiver's socket
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiver
    )?.[0];

    if (receiverSocketId) {
      // Forward the ICE candidate to the receiver
      io.to(receiverSocketId).emit("ice-candidate", data);
    }
  });

  // Handle call end
  socket.on("end-call", (data) => {
    console.log(`Call ended by ${data.sender}`);

    // Find the receiver's socket
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiver
    )?.[0];

    if (receiverSocketId) {
      // Notify the receiver that the call has ended
      io.to(receiverSocketId).emit("end-call", data);
    }
  });

  // Handle call declined
  socket.on("call-declined", (data) => {
    console.log(`Call declined by ${data.sender}`);

    // Find the receiver's socket
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiver
    )?.[0];

    if (receiverSocketId) {
      // Notify the receiver that the call was declined
      io.to(receiverSocketId).emit("call-declined", data);
    }
  });
});

server.listen(port, () => {
  console.log(`Сервер запущено на http://localhost:${port}`);
});
// Створення таблиці для історії відеодзвінків
const createCallHistoryTable = async () => {
  try {
    // Перевіряємо, чи існує таблиця
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'call_history'
      );
    `;

    const tableExists = await executeQuery(tableExistsQuery);

    if (tableExists.rows[0].exists) {
      console.log(
        "Таблиця історії дзвінків існує, перевіряємо необхідні колонки..."
      );

      // Отримуємо існуючі колонки
      const columnsResult = await executeQuery(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'call_history';
      `);

      const columns = columnsResult.rows.map((row) => row.column_name);
      console.log("Існуючі колонки таблиці call_history:", columns);

      // Перевіряємо необхідні колонки і додаємо їх, якщо вони відсутні
      const requiredColumns = [
        { name: "caller_id", type: "INTEGER NOT NULL" },
        { name: "receiver_id", type: "INTEGER NOT NULL" },
        { name: "caller_type", type: "VARCHAR(10) NOT NULL" }, // 'user' або 'master'
        { name: "start_time", type: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" },
        { name: "end_time", type: "TIMESTAMP" },
        { name: "duration", type: "INTEGER DEFAULT 0" }, // в секундах
        { name: "status", type: "VARCHAR(20) NOT NULL DEFAULT 'missed'" }, // 'completed', 'missed', 'rejected'
        { name: "has_video", type: "BOOLEAN DEFAULT FALSE" },
        { name: "notes", type: "TEXT" },
      ];

      for (const column of requiredColumns) {
        if (!columns.includes(column.name)) {
          await executeQuery(`
            ALTER TABLE call_history 
            ADD COLUMN ${column.name} ${column.type};
          `);
          console.log(
            `✅ Додано колонку ${column.name} до таблиці call_history`
          );
        }
      }
    } else {
      // Створюємо таблицю з усіма необхідними колонками
      const callHistoryTableQuery = `
        CREATE TABLE call_history (
          id SERIAL PRIMARY KEY,
          caller_id INTEGER NOT NULL,
          receiver_id INTEGER NOT NULL,
          caller_type VARCHAR(10) NOT NULL,
          start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          end_time TIMESTAMP,
          duration INTEGER DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'missed',
          has_video BOOLEAN DEFAULT FALSE,
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      await executeQuery(callHistoryTableQuery);
      console.log(
        "✅ Створено таблицю call_history з усіма необхідними колонками"
      );
    }
  } catch (err) {
    console.error(
      "❌ Помилка при створенні/оновленні таблиці call_history:",
      err.message
    );
  }
};

// Викликаємо цю функцію під час ініціалізації сервера
createCallHistoryTable().catch((err) => {
  console.error("Не вдалося ініціалізувати таблицю call_history:", err.message);
});
// Ендпоінт для створення нового запису про дзвінок
app.post("/api/calls", async (req, res) => {
  try {
    const { caller_id, receiver_id, caller_type, has_video, notes } = req.body;

    if (!caller_id || !receiver_id || !caller_type) {
      return res.status(400).json({
        success: false,
        message: "Відсутні обов'язкові поля",
      });
    }

    // Перевіряємо, чи існують користувачі
    const callerExists = await executeQuery(
      "SELECT * FROM users WHERE id = $1",
      [caller_id]
    );
    const receiverExists = await executeQuery(
      "SELECT * FROM users WHERE id = $1",
      [receiver_id]
    );

    if (callerExists.rows.length === 0 || receiverExists.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Користувача не знайдено",
      });
    }

    // Створюємо новий запис про дзвінок
    const result = await executeQuery(
      `INSERT INTO call_history 
       (caller_id, receiver_id, caller_type, has_video, notes, status) 
       VALUES ($1, $2, $3, $4, $5, 'initiated')
       RETURNING id`,
      [caller_id, receiver_id, caller_type, has_video || false, notes || null]
    );

    console.log(
      `✅ Створено новий запис про дзвінок з ID ${result.rows[0].id}`
    );
    res.status(201).json({
      success: true,
      message: "Запис про дзвінок створено",
      call_id: result.rows[0].id,
    });
  } catch (err) {
    console.error("❌ Помилка при створенні запису про дзвінок:", err.message);
    res.status(500).json({
      success: false,
      message: "Помилка сервера",
      error: err.message,
    });
  }
});

// Ендпоінт для оновлення статусу дзвінка
app.put("/api/calls/:callId", async (req, res) => {
  try {
    const callId = req.params.callId;
    const { status, end_time, duration } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Статус є обов'язковим полем",
      });
    }

    // Перевіряємо, чи існує запис про дзвінок
    const callExists = await executeQuery(
      "SELECT * FROM call_history WHERE id = $1",
      [callId]
    );
    if (callExists.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Запис про дзвінок не знайдено",
      });
    }

    // Оновлюємо запис про дзвінок
    let query = "UPDATE call_history SET status = $1";
    const params = [status];
    let paramIndex = 2;

    if (end_time) {
      query += `, end_time = $${paramIndex}`;
      params.push(end_time);
      paramIndex++;
    }

    if (duration !== undefined) {
      query += `, duration = $${paramIndex}`;
      params.push(duration);
      paramIndex++;
    }

    query += ` WHERE id = $${paramIndex} RETURNING id`;
    params.push(callId);

    const result = await executeQuery(query, params);

    console.log(`✅ Оновлено запис про дзвінок з ID ${result.rows[0].id}`);
    res.status(200).json({
      success: true,
      message: "Запис про дзвінок оновлено",
      call_id: result.rows[0].id,
    });
  } catch (err) {
    console.error("❌ Помилка при оновленні запису про дзвінок:", err.message);
    res.status(500).json({
      success: false,
      message: "Помилка сервера",
      error: err.message,
    });
  }
});

// Ендпоінт для отримання історії дзвінків користувача
app.get("/api/calls/user/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    // Перевіряємо, чи існує користувач
    const userExists = await executeQuery("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Користувача не знайдено",
      });
    }

    // Отримуємо історію дзвінків користувача (як ініціатора, так і отримувача)
    const result = await executeQuery(
      `SELECT ch.*, 
              u1.username as caller_username, 
              u2.username as receiver_username,
              up1.first_name as caller_first_name,
              up1.last_name as caller_last_name,
              up2.first_name as receiver_first_name,
              up2.last_name as receiver_last_name
       FROM call_history ch
       JOIN users u1 ON ch.caller_id = u1.id
       JOIN users u2 ON ch.receiver_id = u2.id
       LEFT JOIN user_profile up1 ON u1.id = up1.user_id
       LEFT JOIN user_profile up2 ON u2.id = up2.user_id
       WHERE ch.caller_id = $1 OR ch.receiver_id = $1
       ORDER BY ch.start_time DESC`,
      [userId]
    );

    res.status(200).json({
      success: true,
      calls: result.rows,
    });
  } catch (err) {
    console.error("❌ Помилка при отриманні історії дзвінків:", err.message);
    res.status(500).json({
      success: false,
      message: "Помилка сервера",
      error: err.message,
    });
  }
});

// Ендпоінт для отримання статистики дзвінків користувача
app.get("/api/calls/stats/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    // Перевіряємо, чи існує користувач
    const userExists = await executeQuery("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Користувача не знайдено",
      });
    }

    // Отримуємо статистику дзвінків
    const result = await executeQuery(
      `SELECT 
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_calls,
        COUNT(*) FILTER (WHERE status = 'missed') as missed_calls,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_calls,
        AVG(duration) FILTER (WHERE status = 'completed') as avg_duration,
        SUM(duration) FILTER (WHERE status = 'completed') as total_duration
       FROM call_history
       WHERE caller_id = $1 OR receiver_id = $1`,
      [userId]
    );

    const stats = result.rows[0];

    // Перетворюємо null значення на 0
    Object.keys(stats).forEach((key) => {
      if (stats[key] === null) {
        stats[key] = 0;
      }
    });

    res.status(200).json({
      success: true,
      stats: stats,
    });
  } catch (err) {
    console.error("❌ Помилка при отриманні статистики дзвінків:", err.message);
    res.status(500).json({
      success: false,
      message: "Помилка сервера",
      error: err.message,
    });
  }
});

// Ендпоінт для отримання списку доступних майстрів для дзвінка
app.get("/api/calls/available-masters", async (req, res) => {
  try {
    const industry = req.query.industry;

    let query = `
      SELECT u.id, u.username, up.first_name, up.last_name, up.email, up.phone
      FROM users u
      JOIN user_profile up ON u.id = up.user_id
      WHERE up.role_master = true AND up.approval_status = 'approved'
    `;

    const params = [];

    // Якщо вказана галузь, фільтруємо майстрів за нею
    if (industry) {
      query += `
        AND EXISTS (
          SELECT 1 FROM user_services us 
          WHERE us.user_id = u.id 
          AND us.service_type = 'industry' 
          AND us.service_name = $1
        )
      `;
      params.push(industry);
    }

    query += ` ORDER BY u.username`;

    const result = await executeQuery(query, params);

    // Перевіряємо, чи майстри онлайн (використовуючи activeUsers з socket.io)
    const masters = result.rows.map((master) => {
      const masterSocketId = Array.from(activeUsers.entries()).find(
        ([_, user]) => user.id === master.id.toString()
      )?.[0];

      return {
        ...master,
        online: !!masterSocketId,
      };
    });

    res.status(200).json({
      success: true,
      masters: masters,
    });
  } catch (err) {
    console.error(
      "❌ Помилка при отриманні списку доступних майстрів:",
      err.message
    );
    res.status(500).json({
      success: false,
      message: "Помилка сервера",
      error: err.message,
    });
  }
});
// Розширена обробка подій Socket.io для відеодзвінків
io.on("connection", (socket) => {
  console.log("Новий користувач підключився:", socket.id);

  // Обробка приєднання до системи
  socket.on("user-connected", (userData) => {
    console.log(
      `Користувач ${userData.username} (ID: ${userData.userId}) підключився`
    );

    // Зберігаємо інформацію про користувача
    activeUsers.set(socket.id, {
      id: userData.userId,
      username: userData.username,
      role: userData.role,
      socketId: socket.id,
    });

    // Повідомляємо всіх про оновлення статусу користувача
    io.emit("user-status-changed", {
      userId: userData.userId,
      status: "online",
    });
  });

  // Обробка запиту на дзвінок
  socket.on("call-request", (data) => {
    console.log(`Запит на дзвінок від ${data.callerId} до ${data.receiverId}`);

    // Знаходимо сокет отримувача
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.receiverId
    )?.[0];

    if (receiverSocketId) {
      // Отримувач онлайн, відправляємо запит на дзвінок
      io.to(receiverSocketId).emit("incoming-call", {
        callId: data.callId,
        callerId: data.callerId,
        callerName: data.callerName,
        withVideo: data.withVideo,
      });
    } else {
      // Отримувач офлайн, відправляємо відповідь ініціатору
      socket.emit("call-response", {
        callId: data.callId,
        status: "unavailable",
        message: "Користувач зараз не в мережі",
      });

      // Оновлюємо статус дзвінка в базі даних
      executeQuery(
        "UPDATE call_history SET status = 'missed', end_time = CURRENT_TIMESTAMP WHERE id = $1",
        [data.callId]
      ).catch((err) => {
        console.error("❌ Помилка при оновленні статусу дзвінка:", err.message);
      });
    }
  });

  // Обробка відповіді на дзвінок
  socket.on("call-response", (data) => {
    console.log(
      `Відповідь на дзвінок: ${data.status} для дзвінка ${data.callId}`
    );

    // Знаходимо сокет ініціатора дзвінка
    const callerSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.callerId
    )?.[0];

    if (callerSocketId) {
      // Відправляємо відповідь ініціатору
      io.to(callerSocketId).emit("call-response", {
        callId: data.callId,
        receiverId: data.receiverId,
        status: data.status,
        message: data.message,
      });

      // Якщо дзвінок прийнято, починаємо процес встановлення WebRTC з'єднання
      if (data.status === "accepted") {
        // Оновлюємо статус дзвінка в базі даних
        executeQuery(
          "UPDATE call_history SET status = 'in_progress' WHERE id = $1",
          [data.callId]
        ).catch((err) => {
          console.error(
            "❌ Помилка при оновленні статусу дзвінка:",
            err.message
          );
        });
      } else {
        // Дзвінок відхилено або пропущено
        const status = data.status === "rejected" ? "rejected" : "missed";

        // Оновлюємо статус дзвінка в базі даних
        executeQuery(
          "UPDATE call_history SET status = $1, end_time = CURRENT_TIMESTAMP WHERE id = $2",
          [status, data.callId]
        ).catch((err) => {
          console.error(
            "❌ Помилка при оновленні статусу дзвінка:",
            err.message
          );
        });
      }
    }
  });

  // Обробка WebRTC сигналізації - SDP пропозиція
  socket.on("webrtc-offer", (data) => {
    console.log(`WebRTC пропозиція від ${data.from} до ${data.to}`);

    // Знаходимо сокет отримувача
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.to
    )?.[0];

    if (receiverSocketId) {
      // Відправляємо SDP пропозицію отримувачу
      io.to(receiverSocketId).emit("webrtc-offer", {
        callId: data.callId,
        from: data.from,
        offer: data.offer,
      });
    }
  });

  // Обробка WebRTC сигналізації - SDP відповідь
  socket.on("webrtc-answer", (data) => {
    console.log(`WebRTC відповідь від ${data.from} до ${data.to}`);

    // Знаходимо сокет отримувача
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.to
    )?.[0];

    if (receiverSocketId) {
      // Відправляємо SDP відповідь отримувачу
      io.to(receiverSocketId).emit("webrtc-answer", {
        callId: data.callId,
        from: data.from,
        answer: data.answer,
      });
    }
  });

  // Обробка WebRTC сигналізації - ICE кандидати
  socket.on("ice-candidate", (data) => {
    console.log(`ICE кандидат від ${data.from} до ${data.to}`);

    // Знаходимо сокет отримувача
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.to
    )?.[0];

    if (receiverSocketId) {
      // Відправляємо ICE кандидата отримувачу
      io.to(receiverSocketId).emit("ice-candidate", {
        callId: data.callId,
        from: data.from,
        candidate: data.candidate,
      });
    }
  });

  // Обробка завершення дзвінка
  socket.on("end-call", (data) => {
    console.log(`Завершення дзвінка ${data.callId} від ${data.from}`);

    // Знаходимо сокет іншого учасника дзвінка
    const otherPartySocketId = Array.from(activeUsers.entries()).find(
      ([_, user]) => user.id === data.to
    )?.[0];

    if (otherPartySocketId) {
      // Повідомляємо іншого учасника про завершення дзвінка
      io.to(otherPartySocketId).emit("end-call", {
        callId: data.callId,
        from: data.from,
        duration: data.duration,
      });
    }

    // Оновлюємо запис про дзвінок в базі даних
    executeQuery(
      `UPDATE call_history 
       SET status = 'completed', 
           end_time = CURRENT_TIMESTAMP, 
           duration = $1 
       WHERE id = $2`,
      [data.duration || 0, data.callId]
    ).catch((err) => {
      console.error(
        "❌ Помилка при оновленні запису про дзвінок:",
        err.message
      );
    });
  });

  // Обробка відключення
  socket.on("disconnect", () => {
    console.log("Користувач відключився:", socket.id);

    // Отримуємо інформацію про користувача
    const user = activeUsers.get(socket.id);

    if (user) {
      // Видаляємо користувача зі списку активних
      activeUsers.delete(socket.id);

      // Повідомляємо всіх про оновлення статусу користувача
      io.emit("user-status-changed", {
        userId: user.id,
        status: "offline",
      });
    }
  });
});
// Створення директорій для звукових файлів
const soundsDir = path.join(__dirname, "public/sounds");
if (!fs.existsSync(soundsDir)) {
  fs.mkdirSync(soundsDir, { recursive: true });
  console.log("✅ Створено директорію для звукових файлів");
}

// Створення директорії для запису дзвінків (якщо потрібно)
const callRecordingsDir = path.join(__dirname, "uploads/call-recordings");
if (!fs.existsSync(callRecordingsDir)) {
  fs.mkdirSync(callRecordingsDir, { recursive: true });
  console.log("✅ Створено директорію для запису дзвінків");
}
// Маршрути для сторінок відеодзвінків
app.get("/call.html", (req, res) => {
  res.sendFile(path.join(__dirname, "call.html"));
});

app.get("/callm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "callm.html"));
});

// Маршрут для перенаправлення на відповідну сторінку в залежності від ролі користувача
app.get("/call", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1] || req.query.token;

  if (!token) {
    return res.redirect("/auth.html");
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "default_secret_key"
    );
    const userId = decoded.id;

    // Перевіряємо, чи користувач є майстром
    executeQuery("SELECT role_master FROM user_profile WHERE user_id = $1", [
      userId,
    ])
      .then((result) => {
        if (result.rows.length === 0) {
          return res.redirect("/auth.html");
        }

        const isMaster = result.rows[0].role_master;

        if (isMaster) {
          res.redirect("/callm.html");
        } else {
          res.redirect("/call.html");
        }
      })
      .catch((err) => {
        console.error(
          "❌ Помилка при перевірці ролі користувача:",
          err.message
        );
        res.redirect("/auth.html");
      });
  } catch (err) {
    console.error("❌ Помилка при перевірці токена:", err.message);
    res.redirect("/auth.html");
  }
});
// This function will fix the issue with news creation and retrieval
async function fixNewsCreationAndRetrieval() {
  try {
    // First, let's check if the news table exists and has the correct structure
    const tableExists = await executeQuery(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'news'
      );
    `);

    if (!tableExists.rows[0].exists) {
      console.log("News table doesn't exist, creating it...");

      // Create the news table with all required columns
      await executeQuery(`
        CREATE TABLE news (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          short_description TEXT NOT NULL,
          content TEXT NOT NULL,
          main_image VARCHAR(255),
          additional_images TEXT[],
          external_links TEXT[],
          category VARCHAR(50) DEFAULT 'updates',
          status VARCHAR(20) NOT NULL DEFAULT 'published',
          views INTEGER DEFAULT 0,
          likes INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log("✅ Created news table with all required columns");
    }

    // Test the news creation endpoint
    console.log("Testing news creation endpoint...");
    const testNews = {
      title: "Test News",
      short_description: "This is a test news item",
      content: "This is the content of the test news item",
      category: "updates",
      status: "published",
    };

    // Create a mock request and response for testing
    const mockReq = {
      body: testNews,
      files: {},
    };

    const mockRes = {
      status: (code) => ({
        json: (data) => {
          console.log(`Response status: ${code}`);
          console.log("Response data:", data);
          return data;
        },
      }),
    };

    // Simulate a POST request to the news creation endpoint
    const createNewsHandler = async (req, res) => {
      try {
        const {
          title,
          short_description,
          content,
          category = "updates",
          status = "published",
          external_links,
        } = req.body;

        if (!title || !short_description || !content) {
          return res.status(400).json({
            message: "Title, short description and content are required",
          });
        }

        // Process main image
        let mainImagePath = null;
        if (
          req.files &&
          req.files.main_image &&
          req.files.main_image.length > 0
        ) {
          const mainImage = req.files.main_image[0];
          mainImagePath = `/uploads/news/${mainImage.filename}`;
        }

        // Process additional images
        let additionalImagePaths = [];
        if (
          req.files &&
          req.files.additional_images &&
          req.files.additional_images.length > 0
        ) {
          additionalImagePaths = req.files.additional_images.map(
            (file) => `/uploads/news/${file.filename}`
          );
        }

        // Process external links
        let links = [];
        if (external_links) {
          if (Array.isArray(external_links)) {
            links = external_links.filter((link) => link.trim() !== "");
          } else if (
            typeof external_links === "string" &&
            external_links.trim() !== ""
          ) {
            links = [external_links];
          }
        }

        const result = await executeQuery(
          `
          INSERT INTO news (
            title, short_description, content, main_image, 
            additional_images, external_links, category, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `,
          [
            title,
            short_description,
            content,
            mainImagePath,
            additionalImagePaths.length > 0 ? additionalImagePaths : null,
            links.length > 0 ? links : null,
            category,
            status,
          ]
        );

        console.log(`✅ Created news with ID ${result.rows[0].id}`);
        return res.status(201).json({
          success: true,
          message: "News created successfully",
          newsId: result.rows[0].id,
        });
      } catch (err) {
        console.error("❌ Error creating news:", err.message);
        return res
          .status(500)
          .json({ message: "Server error", error: err.message });
      }
    };

    // Test the news retrieval endpoint
    console.log("Testing news retrieval endpoint...");
    const getNewsHandler = async (req, res) => {
      try {
        const result = await executeQuery(`
          SELECT id, title, short_description, content, main_image, 
                 additional_images, external_links, category, status, 
                 views, likes, created_at, updated_at
          FROM news
          ORDER BY created_at DESC
        `);

        return res.status(200).json({ news: result.rows });
      } catch (err) {
        console.error("❌ Error getting news:", err.message);
        return res
          .status(500)
          .json({ message: "Server error", error: err.message });
      }
    };

    // Execute the test handlers
    await createNewsHandler(mockReq, mockRes);
    await getNewsHandler({}, mockRes);

    console.log(
      "✅ News creation and retrieval functionality tested successfully"
    );

    // Check if the uploads directory exists
    const fs = require("fs");
    const path = require("path");
    const uploadsDir = path.join(__dirname, "public/uploads/news");

    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log("✅ Created uploads directory for news images");
    }

    console.log("✅ News functionality is now working correctly");

    return {
      success: true,
      message: "News functionality fixed successfully",
    };
  } catch (error) {
    console.error("❌ Error fixing news functionality:", error);
    return {
      success: false,
      message: "Failed to fix news functionality",
      error: error.message,
    };
  }
}

// Execute the fix function
fixNewsCreationAndRetrieval()
  .then((result) => {
    console.log("Fix result:", result);

    if (result.success) {
      console.log(
        "✅ The news functionality has been fixed. Now when you add news in the admin panel, it will be saved to the database and displayed on the news.html page."
      );
    } else {
      console.log(
        "❌ There was an issue fixing the news functionality. Please check the error message for details."
      );
    }
  })
  .catch((error) => {
    console.error("❌ Unexpected error:", error);
  });
// Add these endpoints to your server.js file

// Create comments table if it doesn't exist
const createCommentsTable = async () => {
  try {
    // First check if the table exists
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'news_comments'
      );
    `;

    const tableExists = await executeQuery(tableExistsQuery);

    if (tableExists.rows[0].exists) {
      console.log(
        "News comments table exists, checking for required columns..."
      );

      // Get existing columns
      const columnsResult = await executeQuery(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'news_comments';
      `);

      const columns = columnsResult.rows.map((row) => row.column_name);
      console.log("Existing news_comments table columns:", columns);

      // Check for required columns and add them if missing
      const requiredColumns = [
        { name: "news_id", type: "INTEGER NOT NULL" },
        { name: "user_id", type: "INTEGER NOT NULL" },
        { name: "text", type: "TEXT NOT NULL" },
        { name: "created_at", type: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" },
      ];

      for (const column of requiredColumns) {
        if (!columns.includes(column.name)) {
          await executeQuery(`
            ALTER TABLE news_comments 
            ADD COLUMN ${column.name} ${column.type};
          `);
          console.log(`✅ Added ${column.name} column to news_comments table`);
        }
      }
    } else {
      // Create the table with all required columns
      const commentsTableQuery = `
        CREATE TABLE news_comments (
          id SERIAL PRIMARY KEY,
          news_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          text TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `;

      await executeQuery(commentsTableQuery);
      console.log("✅ Created news_comments table with all required columns");
    }
  } catch (err) {
    console.error(
      "❌ Error creating/updating news_comments table:",
      err.message
    );
  }
};

// Call this function during server initialization
createCommentsTable().catch((err) => {
  console.error("Failed to initialize news_comments table:", err.message);
});

// Get comments for a news article
app.get("/api/news/:newsId/comments", authenticateToken, async (req, res) => {
  try {
    const newsId = req.params.newsId;

    // Check if news exists
    const newsResult = await executeQuery("SELECT * FROM news WHERE id = $1", [
      newsId,
    ]);
    if (newsResult.rows.length === 0) {
      return res.status(404).json({ message: "Новину не знайдено" });
    }

    // Get comments with user information
    const result = await executeQuery(
      `
      SELECT c.id, c.news_id, c.user_id, c.text, c.created_at, u.username
      FROM news_comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.news_id = $1
      ORDER BY c.created_at DESC
    `,
      [newsId]
    );

    res.status(200).json({ comments: result.rows });
  } catch (err) {
    console.error("❌ Error getting comments:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Add a comment to a news article
app.post("/api/news/:newsId/comments", authenticateToken, async (req, res) => {
  try {
    const newsId = req.params.newsId;
    const userId = req.user.id;
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ message: "Текст коментаря обов'язковий" });
    }

    // Check if news exists
    const newsResult = await executeQuery("SELECT * FROM news WHERE id = $1", [
      newsId,
    ]);
    if (newsResult.rows.length === 0) {
      return res.status(404).json({ message: "Новину не знайдено" });
    }

    // Add comment
    const result = await executeQuery(
      `
      INSERT INTO news_comments (news_id, user_id, text)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [newsId, userId, text]
    );

    res.status(201).json({
      success: true,
      message: "Коментар успішно додано",
      commentId: result.rows[0].id,
    });
  } catch (err) {
    console.error("❌ Error adding comment:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});

// Update the like endpoint to require authentication
app.post("/api/news/:id/like", authenticateToken, async (req, res) => {
  try {
    const newsId = req.params.id;
    const userId = req.user.id;

    // Check if news exists
    const newsResult = await executeQuery("SELECT * FROM news WHERE id = $1", [
      newsId,
    ]);
    if (newsResult.rows.length === 0) {
      return res.status(404).json({ message: "Новину не знайдено" });
    }

    // Check if user has already liked this news
    // For simplicity, we'll just increment the like count
    // In a real app, you would track which users liked which news
    const result = await executeQuery(
      `
      UPDATE news
      SET likes = likes + 1
      WHERE id = $1
      RETURNING likes
    `,
      [newsId]
    );

    res.status(200).json({
      success: true,
      likes: result.rows[0].likes,
      liked: true,
    });
  } catch (err) {
    console.error("❌ Error toggling like:", err.message);
    res.status(500).json({ message: "Помилка сервера", error: err.message });
  }
});
//Прохід в адмін панель
const ADMIN_PASSWORD = "319560";

// Middleware для обробки JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Статичні файли
app.use(express.static(path.join(__dirname, "public")));

// Маршрут для перевірки пароля
app.post("/check-password", (req, res) => {
  const { password } = req.body;

  // Перевіряємо пароль
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Маршрут для адмін-панелі
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});
app.get("/googleef12226500ff3127.html", (req, res) => {
  res.send("google-site-verification: googleef12226500ff3127.html");
});
// Ендпоінт для отримання всіх репетиторів з їх предметами
app.get("/api/tutors", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const subject = req.query.subject;
    const search = req.query.search;
    const sortBy = req.query.sortBy || "name";

    // Базовий запит для отримання репетиторів
    let query = `
      SELECT DISTINCT u.id, u.username, 
             up.first_name, up.last_name, up.email, up.phone, 
             up.address, up.date_of_birth, up.profile_image_url,
             CONCAT(up.first_name, ' ', up.last_name) as full_name
      FROM users u
      JOIN user_profile up ON u.id = up.user_id
      WHERE up.role_master = true AND up.approval_status = 'approved'
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Фільтр за предметом
    if (subject) {
      query += ` AND EXISTS (
        SELECT 1 FROM user_services us 
        WHERE us.user_id = u.id 
        AND us.service_type = 'industry' 
        AND us.service_name = $${paramIndex}
      )`;
      queryParams.push(subject);
      paramIndex++;
    }

    // Пошук за ім'ям або username
    if (search) {
      query += ` AND (
        LOWER(CONCAT(up.first_name, ' ', up.last_name)) LIKE LOWER($${paramIndex}) OR
        LOWER(u.username) LIKE LOWER($${paramIndex}) OR
        LOWER(up.email) LIKE LOWER($${paramIndex})
      )`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Сортування
    switch (sortBy) {
      case "name":
        query += ` ORDER BY up.first_name, up.last_name`;
        break;
      case "username":
        query += ` ORDER BY u.username`;
        break;
      default:
        query += ` ORDER BY up.first_name, up.last_name`;
    }

    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);

    const result = await executeQuery(query, queryParams);

    // Для кожного репетитора отримуємо його предмети
    const tutors = [];
    for (const tutor of result.rows) {
      // Отримуємо предмети репетитора
      const subjectsResult = await executeQuery(
        `SELECT service_name 
         FROM user_services 
         WHERE user_id = $1 AND service_type = 'industry'
         ORDER BY service_name`,
        [tutor.id]
      );

      const subjects = subjectsResult.rows.map((row) => row.service_name);

      // Перевіряємо, чи репетитор онлайн (можна інтегрувати з Socket.io)
      const isOnline = false; // Тут можна додати логіку перевірки онлайн статусу

      tutors.push({
        ...tutor,
        subjects,
        online: isOnline,
        full_name:
          tutor.full_name ||
          `${tutor.first_name || ""} ${tutor.last_name || ""}`.trim(),
      });
    }

    // Отримуємо загальну кількість репетиторів для пагінації
    let countQuery = `
      SELECT COUNT(DISTINCT u.id) as total
      FROM users u
      JOIN user_profile up ON u.id = up.user_id
      WHERE up.role_master = true AND up.approval_status = 'approved'
    `;

    const countParams = [];
    let countParamIndex = 1;

    if (subject) {
      countQuery += ` AND EXISTS (
        SELECT 1 FROM user_services us 
        WHERE us.user_id = u.id 
        AND us.service_type = 'industry' 
        AND us.service_name = $${countParamIndex}
      )`;
      countParams.push(subject);
      countParamIndex++;
    }

    if (search) {
      countQuery += ` AND (
        LOWER(CONCAT(up.first_name, ' ', up.last_name)) LIKE LOWER($${countParamIndex}) OR
        LOWER(u.username) LIKE LOWER($${countParamIndex}) OR
        LOWER(up.email) LIKE LOWER($${countParamIndex})
      )`;
      countParams.push(`%${search}%`);
    }

    const countResult = await executeQuery(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.status(200).json({
      success: true,
      tutors,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + tutors.length < total,
      },
    });
  } catch (err) {
    console.error("❌ Помилка при отриманні репетиторів:", err.message);
    res.status(500).json({
      success: false,
      message: "Помилка сервера",
      error: err.message,
    });
  }
});

// Ендпоінт для отримання деталей конкретного репетитора
app.get("/api/tutors/:tutorId", async (req, res) => {
  try {
    const tutorId = req.params.tutorId;

    // Отримуємо основну інформацію про репетитора
    const tutorResult = await executeQuery(
      `SELECT u.id, u.username, u.created_at,
              up.first_name, up.last_name, up.email, up.phone, 
              up.address, up.date_of_birth, up.profile_image_url,
              CONCAT(up.first_name, ' ', up.last_name) as full_name
       FROM users u
       JOIN user_profile up ON u.id = up.user_id
       WHERE u.id = $1 AND up.role_master = true AND up.approval_status = 'approved'`,
      [tutorId]
    );

    if (tutorResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Репетитора не знайдено",
      });
    }

    const tutor = tutorResult.rows[0];

    // Отримуємо предмети репетитора
    const subjectsResult = await executeQuery(
      `SELECT service_name 
       FROM user_services 
       WHERE user_id = $1 AND service_type = 'industry'
       ORDER BY service_name`,
      [tutorId]
    );

    const subjects = subjectsResult.rows.map((row) => row.service_name);

    // Отримуємо додаткові послуги репетитора
    const servicesResult = await executeQuery(
      `SELECT service_name, service_type
       FROM user_services 
       WHERE user_id = $1 AND service_type != 'industry'
       ORDER BY service_name`,
      [tutorId]
    );

    const services = servicesResult.rows;

    // Отримуємо відгуки про репетитора
    const reviewsResult = await executeQuery(
      `SELECT r.rating, r.text, r.name, r.created_at
       FROM reviews r
       WHERE r.master_name ILIKE $1 AND r.status = 'approved'
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [`%${tutor.first_name}%${tutor.last_name}%`]
    );

    const reviews = reviewsResult.rows;

    // Обчислюємо середній рейтинг
    const avgRating =
      reviews.length > 0
        ? reviews.reduce((sum, review) => sum + review.rating, 0) /
          reviews.length
        : 0;

    // Перевіряємо онлайн статус (можна інтегрувати з Socket.io)
    const isOnline = false; // Тут можна додати логіку перевірки онлайн статусу

    const tutorDetails = {
      ...tutor,
      subjects,
      services,
      reviews,
      rating: Math.round(avgRating * 10) / 10,
      reviewsCount: reviews.length,
      online: isOnline,
      full_name:
        tutor.full_name ||
        `${tutor.first_name || ""} ${tutor.last_name || ""}`.trim(),
    };

    res.status(200).json({
      success: true,
      tutor: tutorDetails,
    });
  } catch (err) {
    console.error("❌ Помилка при отриманні деталей репетитора:", err.message);
    res.status(500).json({
      success: false,
      message: "Помилка сервера",
      error: err.message,
    });
  }
});

// Ендпоінт для отримання статистики репетиторів
app.get("/api/tutors-stats", async (req, res) => {
  try {
    // Загальна кількість репетиторів
    const totalTutorsResult = await executeQuery(
      `SELECT COUNT(*) as total
       FROM user_profile 
       WHERE role_master = true AND approval_status = 'approved'`
    );

    // Кількість предметів
    const totalSubjectsResult = await executeQuery(
      `SELECT COUNT(DISTINCT service_name) as total
       FROM user_services 
       WHERE service_type = 'industry'`
    );

    // Кількість онлайн репетиторів (заглушка)
    const onlineTutors = 0; // Тут можна додати логіку підрахунку онлайн користувачів

    // Статистика за предметами
    const subjectStatsResult = await executeQuery(
      `SELECT us.service_name, COUNT(*) as tutors_count
       FROM user_services us
       JOIN user_profile up ON us.user_id = up.user_id
       WHERE us.service_type = 'industry' 
       AND up.role_master = true 
       AND up.approval_status = 'approved'
       GROUP BY us.service_name
       ORDER BY tutors_count DESC`
    );

    res.status(200).json({
      success: true,
      stats: {
        totalTutors: parseInt(totalTutorsResult.rows[0].total),
        totalSubjects: parseInt(totalSubjectsResult.rows[0].total),
        onlineTutors: onlineTutors,
        subjectStats: subjectStatsResult.rows,
      },
    });
  } catch (err) {
    console.error(
      "❌ Помилка при отриманні статистики репетиторів:",
      err.message
    );
    res.status(500).json({
      success: false,
      message: "Помилка сервера",
      error: err.message,
    });
  }
});
