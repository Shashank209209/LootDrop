import { app } from './app.js';
import { env } from './config/env.js';
import { enrichmentDisabledMessage } from './pricing/rawg/run-enrichment.js';

if (!env.RAWG_API_KEY) console.warn(enrichmentDisabledMessage);
app.listen(env.API_PORT, () => {
  console.info(`DealHunter API listening on http://localhost:${env.API_PORT}`);
});
