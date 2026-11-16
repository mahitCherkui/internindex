/**
 * Job sites this app never requests, because their terms forbid automated
 * access or the listings sit behind a login: LinkedIn, Handshake, Indeed,
 * Glassdoor, Jobright, Wellfound, Built In, Levels.fyi, Otta / Welcome to the
 * Jungle, RippleMatch, Dice, ZipRecruiter, Simplify's own site and
 * intern-list.com. Postings from them come in only through the Import flow,
 * from what the user pastes, and their links are stored, never fetched.
 */
export const NO_FETCH_HOSTS =
  /(?:^|\.)(?:linkedin\.com|joinhandshake\.com|handshake\.com|indeed\.com|glassdoor\.com|jobright\.ai|wellfound\.com|angel\.co|builtin\.com|builtin[a-z]+\.com|levels\.fyi|otta\.com|welcometothejungle\.com|ripplematch\.com|dice\.com|ziprecruiter\.com|simplify\.jobs|intern-list\.com)$/i;

