// Stands in for `claude -p` in tests: reads the prompt on stdin and answers with the question and the folder.
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const question = /Question: (.*)/.exec(input)?.[1] ?? '?';
  if (question.includes('fail')) process.exit(3);
  console.log(`Answer to "${question}" from ${process.cwd()}`);
});
