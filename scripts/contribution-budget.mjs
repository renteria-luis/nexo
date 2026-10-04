import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** GitHub groups commit contributions by the author's calendar day in UTC. */
export function countCommitsOnUtcDay(log, email, day) {
  return log.split('\n').filter((row) => {
    const [authoredAt, authorEmail] = row.split('\t');
    return authorEmail === email && new Date(authoredAt).toISOString().slice(0, 10) === day;
  }).length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const email = execFileSync('git', ['config', 'user.email'], { encoding: 'utf8' }).trim();
  const log = execFileSync('git', ['log', 'origin/main', '--format=%aI%x09%ae'], {
    encoding: 'utf8',
  });
  const day = new Date().toISOString().slice(0, 10);
  const commits = countCommitsOnUtcDay(log, email, day);
  console.log(
    `${day} UTC: ${commits} owner commits on origin/main. Target: 4–7; ceiling: 13 contributions.`,
  );
  console.log('Include today’s opened and merged PRs in the same budget.');
}
