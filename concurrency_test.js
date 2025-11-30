const axios = require('axios');


const BASE_URL = 'http://localhost:3000';
const ID = '6367072'; // Change to a valid id in your DB

async function updateMovie(instance, delay = 0) {
  await new Promise(res => setTimeout(res, delay));
  try {
    const res = await axios.post(`${BASE_URL}/movies/${ID}`, {
      titleType: 'movie',
      primaryTitle: `Concurrent Update ${instance}`,
      originalTitle: `Original ${instance}`,
      isAdult: false,
      startYear: 2025,
      endYear: null,
      runtimeMinutes: 120,
      genres: 'Drama'
    });
    console.log(`Instance ${instance}: Success`, res.status);
  } catch (err) {
    if (err.response) {
      console.log(`Instance ${instance}: Error`, err.response.status, err.response.data);
    } else {
      console.log(`Instance ${instance}: Network Error`, err.message);
    }
  }
}

async function runConcurrentUpdates() {
  const promises = [];
  for (let i = 1; i <= 5; i++) {
    promises.push(updateMovie(i, i * 10)); // Slight delay between requests
  }
  await Promise.all(promises);
  console.log('All updates finished.');
}

runConcurrentUpdates();
