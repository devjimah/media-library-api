// Integration test for the health-check endpoint used by deployment monitors.

import request from 'supertest';
import app from '../../app';

describe('GET /health', () => {
    it('returns 200 with status, uptime, and timestamp', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(typeof res.body.uptime).toBe('number');
        expect(typeof res.body.timestamp).toBe('string');
        // timestamp must be a valid ISO date
        expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
    });
});
