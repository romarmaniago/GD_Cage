module.exports = {
  apps: [
    {
      name: "CageDemo",
      script: "app.js", 
      env: {
        DB_HOST: "127.0.0.1",
        DB_USER: "3core",
        DB_PASSWORD: "2024.3core21",
        DB_NAME: "gdcage",
        DB_PORT: 3306,
        REDIS_HOST: "127.0.0.1",
        REDIS_PORT: 6379,
        SESSION_SECRET: "your_secret_key",
        PORT: 4000
      }
    }
  ]
};
