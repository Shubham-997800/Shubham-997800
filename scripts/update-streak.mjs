import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const streakSvgPath = path.join(rootDir, 'streak.svg');

const token = process.env.PAT_TOKEN || process.env.GITHUB_TOKEN;
const username = 'Shubham-997800';

async function fetchContributions() {
  const query = `
    query($user: String!) {
      user(login: $user) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
      }
    }
  `;

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'streak-updater',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables: { user: username } }),
  });

  const json = await res.json();
  if (!json.data?.user) {
    console.error('Failed to fetch contributions:', json);
    return null;
  }

  const calendar = json.data.user.contributionsCollection.contributionCalendar;
  const days = calendar.weeks.flatMap((w) => w.contributionDays);
  return { total: calendar.totalContributions, days };
}

function calculateStreak(days) {
  // Sort days ascending
  const sorted = [...days].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Find current streak by scanning backwards from today/yesterday
  // Account for IST (+05:30)
  const now = new Date();
  const todayStr = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const yesterdayDate = new Date(now.getTime() + 5.5 * 3600 * 1000 - 86400000);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

  let currentStreak = 0;
  let streakStartDate = null;
  let streakEndDate = null;

  // Find index of today or yesterday
  const dayMap = new Map(sorted.map(d => [d.date, d.contributionCount]));

  // Check if today has contributions, or start from yesterday if today is still 0
  let checkDate = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const todayCount = dayMap.get(todayStr) || 0;
  if (todayCount === 0) {
    checkDate = yesterdayDate;
  }

  while (true) {
    const dStr = checkDate.toISOString().slice(0, 10);
    const count = dayMap.get(dStr) || 0;
    if (count > 0) {
      if (currentStreak === 0) {
        streakEndDate = dStr;
      }
      streakStartDate = dStr;
      currentStreak++;
      checkDate = new Date(checkDate.getTime() - 86400000);
    } else {
      break;
    }
  }

  // Calculate longest streak
  let longestStreak = 0;
  let tempStreak = 0;
  for (const d of sorted) {
    if (d.contributionCount > 0) {
      tempStreak++;
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
      }
    } else {
      tempStreak = 0;
    }
  }

  return {
    currentStreak,
    streakStartDate,
    streakEndDate,
    longestStreak,
  };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

async function run() {
  console.log('Fetching GitHub contribution data for', username);
  const data = await fetchContributions();
  if (!data) {
    console.log('No data retrieved.');
    return;
  }

  const { currentStreak, streakStartDate, streakEndDate, longestStreak } = calculateStreak(data.days);
  console.log({ currentStreak, streakStartDate, streakEndDate, longestStreak, total: data.total });

  if (fs.existsSync(streakSvgPath)) {
    let svgContent = fs.readFileSync(streakSvgPath, 'utf8');

    // Update streak range text: e.g. Sep 16 - Sep 20
    if (streakStartDate && streakEndDate) {
      const rangeStr = `${formatDate(streakStartDate)} - ${formatDate(streakEndDate)}`;
      svgContent = svgContent.replace(
        /(<!-- Current Streak range -->[\s\S]*?<text[^>]*>)([\s\S]*?)(<\/text>)/,
        (match, p1, p2, p3) => `${p1}\n                        ${rangeStr}\n                    ${p3}`
      );
    }

    // Update current streak number
    if (currentStreak > 0) {
      svgContent = svgContent.replace(
        /(<!-- Current Streak big number -->[\s\S]*?<text[^>]*>)([\s\S]*?)(<\/text>)/,
        (match, p1, p2, p3) => `${p1}\n                        ${currentStreak}\n                    ${p3}`
      );
    }

    // Update longest streak number if greater
    if (longestStreak > 0) {
      svgContent = svgContent.replace(
        /(<!-- Longest Streak big number -->[\s\S]*?<text[^>]*>)([\s\S]*?)(<\/text>)/,
        (match, p1, p2, p3) => {
          const prevLongest = parseInt(p2.trim(), 10) || 0;
          const best = Math.max(prevLongest, longestStreak);
          return `${p1}\n                        ${best}\n                    ${p3}`;
        }
      );
    }

    // Update total contributions only if fetched total exceeds current SVG total (preserves private contribution count)
    const currentTotalMatch = svgContent.match(/<!-- Total Contributions big number -->[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>/);
    const currentSvgTotal = currentTotalMatch ? parseInt(currentTotalMatch[1].replace(/,/g, '').trim(), 10) || 0 : 0;
    if (data.total > currentSvgTotal) {
      const formattedTotal = data.total.toLocaleString();
      svgContent = svgContent.replace(
        /(<!-- Total Contributions big number -->[\s\S]*?<text[^>]*>)([\s\S]*?)(<\/text>)/,
        (match, p1, p2, p3) => `${p1}\n                        ${formattedTotal}\n                    ${p3}`
      );
    }

    // Ensure opacity is 1 so GitHub Camo proxy never renders a blank image
    svgContent = svgContent.replace(/opacity: 0/g, 'opacity: 1');

    fs.writeFileSync(streakSvgPath, svgContent, 'utf8');
    console.log('Successfully updated streak.svg!');
  }
}

run().catch(console.error);
