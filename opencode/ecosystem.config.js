// https://pm2.keymetrics.io/docs/usage/application-declaration/
module.exports = {
  apps: [
    {
      name: "kimaki",
      script: "bunx kimaki",
      max_memory_restart: "8G",
    },
  ],
};
