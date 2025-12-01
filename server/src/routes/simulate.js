const express = require('express');
const router = express.Router();

// TODO: Implement simulation logic here
// GET /api/simulate?isolation=READ_COMMITTED
router.get('/simulate', (req, res) => {
  const isolationLevel = req.query.isolation || 'READ_COMMITTED';
  console.log(`[SIMULATION] Selected isolation level: ${isolationLevel}`);
  res.json({
    message: `Simulation received with isolation level: ${isolationLevel}`
  });
});


module.exports = router;
