import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('trả về status ok và thời gian ISO UTC', () => {
    const result = new HealthController().check();

    expect(result.status).toBe('ok');
    expect(new Date(result.time).toISOString()).toBe(result.time);
  });
});
