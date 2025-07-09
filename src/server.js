const Application = require('./app');

// Create and start the application
const app = new Application();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  await app.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  await app.shutdown();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('❌ Uncaught Exception:', error);
  await app.shutdown();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  await app.shutdown();
  process.exit(1);
});

// Start the application
async function start() {
  try {
    await app.initialize();
    console.log('🎉 Application started successfully');
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

start();
