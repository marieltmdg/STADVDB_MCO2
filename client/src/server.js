require('dotenv').config();
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const path = require('path');

const movieRoutes = require('./routes/movies');

const app = express();
const PORT = process.env.PORT || 3000;

// Set view engine and layout
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Middleware
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));

// Routes
app.use('/movies', movieRoutes);

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/movies');
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).render('404');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).render('error', { error: err });
});

app.listen(PORT, () => {
  console.log(`[INFO] Frontend server running on port ${PORT}`);
  console.log(`[INFO] Visit http://localhost:${PORT} to view the application`);
});

module.exports = app;