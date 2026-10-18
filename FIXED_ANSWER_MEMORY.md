# Fixed Answer Memory — Implementation Notes

- Fixed answers are saved only after a user presses the save button.
- The private JSON file is `survey-ai-answer-memory.json` under the app's document directory. AsyncStorage is retained as a fallback/migration copy.
- The matching key is the normalized question plus a normalized, order-independent set of options.
- Normalization removes punctuation/diacritics and normalizes common Arabic letter variants, but **does not** use fuzzy similarity; negation and meaningful wording still matter.
- The saved answer is immutable during `saveMemory`: an existing answer is returned unchanged. To replace it, delete the item from the fixed-memory list first.
- On multiple-choice repeats, the stored selected option is mapped by its label to the new position if option order changed.
- Open-text answers can be drafted by Gemini only when it has enough context, and can be manually edited before being fixed. The server prompt instructs Gemini not to fabricate personal facts.
- The memory screen supports deleting entries and exporting the current user's entries as JSON through Expo Sharing.
- Validation run in this working copy: 6 fixed-memory unit tests passed; 7 backend tests passed; backend syntax checks passed; 20 TS/TSX files passed syntax parsing. The full Expo type check / APK build has not been run because dependencies are not installed in this environment.

- Export is available; an in-app JSON import/restore flow is not included yet. Keep the exported copy separately before clearing app data or uninstalling.
