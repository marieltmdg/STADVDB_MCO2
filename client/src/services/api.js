const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000
});

module.exports = {
  movies: {
    async getAll() {
      try {
        const response = await apiClient.get('/movies');
        return response.data.data || [];
      } catch (error) {
        console.error('[ERROR] Failed to fetch movies:', error.message);
        throw new Error('Failed to fetch movies from API');
      }
    },

    async getById(id) {
      try {
        const response = await apiClient.get(`/movies/${id}`);
        return response.data.data;
      } catch (error) {
        if (error.response && error.response.status === 404) {
          return null;
        }
        console.error('[ERROR] Failed to fetch movie:', error.message);
        throw new Error('Failed to fetch movie from API');
      }
    },

    async create(movie) {
      try {
        const response = await apiClient.post('/movies', movie);
        return response.data.data;
      } catch (error) {
        console.error('[ERROR] Failed to create movie:', error.message);
        throw new Error(error.response?.data?.error || 'Failed to create movie');
      }
    },

    async update(id, movie) {
      try {
        const response = await apiClient.put(`/movies/${id}`, movie);
        return response.data;
      } catch (error) {
        if (error.response && error.response.status === 404) {
          throw new Error('Movie not found');
        }
        console.error('[ERROR] Failed to update movie:', error.message);
        throw new Error(error.response?.data?.error || 'Failed to update movie');
      }
    },

    async delete(id) {
      try {
        const response = await apiClient.delete(`/movies/${id}`);
        return response.data;
      } catch (error) {
        if (error.response && error.response.status === 404) {
          throw new Error('Movie not found');
        }
        console.error('[ERROR] Failed to delete movie:', error.message);
        throw new Error(error.response?.data?.error || 'Failed to delete movie');
      }
    },

    async search(params) {
      try {
        const response = await apiClient.get('/movies/search', { params });
        return response.data.data || [];
      } catch (error) {
        console.error('[ERROR] Failed to search movies:', error.message);
        throw new Error('Failed to search movies');
      }
    }
  }
};