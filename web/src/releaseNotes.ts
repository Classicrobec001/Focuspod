/**
 * Release notes shown in Settings → What's New.
 *
 * Newest first. `version` is compared against the version the user last read,
 * so adding an entry here is all it takes to mark What's New as unread — there
 * is no backend and nothing to publish separately.
 *
 * The catalog itself needs no entries: books and podcast episodes come straight
 * from the Internet Archive and from each show's RSS feed, so new material
 * appears on its own without a release.
 */

export interface ReleaseNote {
  version: string;
  date: string;
  items: string[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.7.0',
    date: 'August 2026',
    items: [
      'Eight themes. Settings › Theme — Classic, Midnight, Strawberry and five more.',
      'Listening streaks: ten minutes a day keeps it going. Streak on the main menu.',
      'Save single chapters: press ▶▶ on any chapter, find them under Favourites › Favourite Chapters.',
      'Optional account: give an email, get a sign-in link, and your favourites, streak and theme follow you to every device.',
    ],
  },
  {
    version: '1.6.0',
    date: 'August 2026',
    items: [
      'Favourites: save any book or show and find it again from the main menu.',
    ],
  },
  {
    version: '1.5.0',
    date: 'August 2026',
    items: [
      'Choose a different reader: Other Recordings on any book lists the other LibriVox readings, by narrator.',
      'The narrator is shown on the book screen where LibriVox states one.',
      'New versions of the app now load straight away instead of waiting for a later visit.',
    ],
  },
  {
    version: '1.4.0',
    date: 'August 2026',
    items: [
      'Tap a row to open it, as an alternative to the wheel. Turn it off in Settings.',
      'About the builder, in Settings.',
      'This screen.',
    ],
  },
  {
    version: '1.3.0',
    date: 'August 2026',
    items: [
      'Podcasts: current shows on business, finance, marketing, design, psychology and more.',
      'Search now uses your keyboard instead of spelling with the wheel.',
    ],
  },
  {
    version: '1.2.0',
    date: 'August 2026',
    items: [
      'Browse by genre, including Islam, Christianity, Judaism, Buddhism and Hinduism.',
      'Sort the library by popular, recently added or title.',
      'Read Along now follows the audio chapter by chapter instead of guessing.',
    ],
  },
  {
    version: '1.1.0',
    date: 'August 2026',
    items: [
      'Downloads work properly offline, resume on their own and report real progress.',
      'Read Along: the printed text beside the recording.',
    ],
  },
];

export const CURRENT_VERSION = RELEASE_NOTES[0].version;

/** True when there are notes the user has not seen. */
export function hasUnreadNotes(lastSeenVersion: string | null): boolean {
  return lastSeenVersion !== CURRENT_VERSION;
}
