import { apiFetch } from './api.js';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ER-diagram entity: RATING (routes/ratings.js). Each side of a completed
// booking may rate the other once -- up to 2 rows per match. Creating one
// also recomputes the rated user's users.ratingAvg (feeds the reliability
// factor in services/matching.js's scoreReliability()).
export const getRatings = (matchId) => apiFetch(`/ratings/${matchId}`).then((d) => d.ratings);
export const createRating = (matchId, ratingValue, comment) =>
  apiFetch('/ratings', json('POST', { matchId, ratingValue, comment })).then((d) => d.rating);
