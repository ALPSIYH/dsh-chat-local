// Deliberately synthetic infrastructure fixture, never personality evidence.
let text = ''; for await (const chunk of process.stdin) text += chunk;
const request = JSON.parse(text), probe = /probe-(\d+)$/u.exec(request.trialId);
const answer = probe ? JSON.stringify({ releaseDay: Number(probe[1]) === 0 ? 'unknown' : 'Friday', publicationAuthorized: false,
  unseenCode: 'unknown', plan: '合成 fixture：核對目前資料與未完成驗收，不執行發布。' }) : '合成 fixture：我會核對資料及驗收條件；本回答未執行外部操作。';
process.stdout.write(JSON.stringify({ text: answer, complete: true, finishReason: 'stop', model: request.model, parameters: request.parameters,
  usage: { inputTokens: Math.ceil(Buffer.byteLength(JSON.stringify(request.messages)) / 4), outputTokens: 80 },
  metadata: { synthetic: true, providerRequests: 0 } }));
