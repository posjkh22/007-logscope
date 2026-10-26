const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(__dirname, '../examples');
fs.mkdirSync(directory, { recursive: true });
const services = ['api-gateway', 'payment-service', 'background-worker'];
services.forEach((service, index) => {
  const rows = [];
  for (let i = 0; i < 1800 + index * 420; i++) {
    const date = new Date(Date.UTC(2026, 9, 23, 0, 0, i * 2 + index));
    const stamp = date.toISOString().replace('T', ' ').replace('Z', '');
    let level = i % 47 === 0 ? 'DEBUG' : 'INFO';
    let message = `Request completed method=GET path=/api/v1/${index ? 'payments' : 'orders'} status=200 duration=${12 + i % 73}ms trace_id=tr_${(i * 9137).toString(16).padStart(8, '0')}`;
    if (i % 83 === 16) { level = 'ERROR'; message = `Connection timeout after 5000ms upstream=payment-db:5432 retry=${i % 3 + 1} trace_id=tr_${(i * 9137).toString(16).padStart(8, '0')}`; }
    else if (i % 113 === 27) { level = 'WARN'; message = `Upstream timeout approaching threshold duration=4200ms limit=5000ms pool=primary`; }
    else if (i % 61 === 8) { level = 'WARN'; message = `Rate limit threshold reached client=10.0.2.${i % 255} remaining=12`; }
    else if (i % 41 === 3) { message = `결제 처리 완료 order_id=ORD-${10000 + i} amount=39000 currency=KRW`; }
    rows.push(`${stamp}  ${level.padEnd(5)}  [${service}] ${message}`);
    if (level === 'ERROR') rows.push('    at ConnectionPool.acquire (database/pool.js:148:17)', '    at async PaymentRepository.findById (repositories/payment.js:62:9)');
  }
  fs.writeFileSync(path.join(directory, `${service}.log`), rows.join('\n') + '\n', 'utf8');
});
console.log('Generated 3 demo logs.');
