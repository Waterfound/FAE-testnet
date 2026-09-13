let input = '';
for await (const chunk of process.stdin) input += chunk;
const payload = JSON.parse(input);
if (payload.height !== 10 || payload.enabled !== true) process.exitCode = 1;
