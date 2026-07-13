const http = require("http");

module.exports = async () => {
  if (process.env.EXPEDICE_TEST_URL) return;
  await new Promise((resolve) => {
    const request = http.request(
      { hostname: "127.0.0.1", port: 8123, path: "/__shutdown", method: "POST", timeout: 1500 },
      () => resolve()
    );
    request.on("error", () => resolve());
    request.on("timeout", () => {
      request.destroy();
      resolve();
    });
    request.end();
  });
};
