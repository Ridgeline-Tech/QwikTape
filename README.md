<p align="center">
<img src="Logo.png"
     alt="QwikTape logo by Viral Ghelani" width="144" height="166">
</p>
<p  align="center">
Do calculations, annotate it like you would on a paper "qwikly". 
</p>
<img src="build/main-screen.png" width="750">

## Android WebView port

This fork adds a plain QwikTape calculator for Android while retaining the
original desktop source and MIT license. The Android app uses a minimal Kotlin
WebView shell around locally bundled HTML, CSS, and JavaScript. It requests no
`INTERNET` permission and blocks navigation away from its synthetic local
origin. No Sciter component is included in the APK.

The Android tape engine is a pure JavaScript module:

```text
{ text, locale, decimalDigits, padding } -> { edits, tokens, diagnostics, variables }
```

It reuses the upstream Chevrotain grammar and replaces QuickJS operator-
overloaded `BigDecimal` values with explicit decimal.js operations. Decimal
addition and multiplication remain exact within the configured 1,000-digit
working precision. Non-terminating division is rounded half-even to the
upstream maximum of 113 fractional digits. Display precision remains
configurable from 0 to 50 digits.

The Android UI includes editable free-text tapes, result blocks, annotations,
named values, local persistence, open/close/cycle tabs, browse/rename/delete,
locale and padding settings, optional `×`/`÷` entry, optional Escape-to-clear,
and keyboard undo/redo that reparses downstream totals. It intentionally adds
no Pocket Builder construction features.

PDF export is deferred. Production signing, release publication, Zac's Apps
catalog registration, and device installation are separate decisions and are
not configured or performed by this repository change.

### Golden behavior method

The behavior oracle is upstream commit
`e781115a9dd2168e4933f95ed7eb88c82a5c9318` (tree
`f739c7e31c24cdfc36b7965e7502af35c3248e92`).
`tests/run-upstream-golden.qjs.js` runs the unchanged upstream
`tests/sciter-tape-grammar.tests.js` under QuickJS 2024-01-13 with its bignum
extensions. The compatibility surface supplies only `sciter.import` and the
upstream test-runner assertions. The parser, evaluator, Chevrotain 10.5.0,
BigDecimal behavior, grammar tests, and `src/storage/seeds.js` inputs remain
the pinned upstream code. Its captured reference is
`tests/upstream-e781115a.golden.json`.

The first capture passed 14 locale groups, 196 cases, and 980 assertions. CI
then compares the Android engine with every focused golden case and both full
seed tapes, in addition to focused unit tests.

### Build and test

```sh
npm ci
npm run check
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

The debug APK is intentionally signed only with Gradle's throwaway debug key.
CI checks its package/version with `aapt2`, verifies its debug signature with
`apksigner`, rejects `INTERNET`, and rejects Sciter/native desktop binaries.
See `NOTICE` for third-party attribution and the dated port change notice.


# Features
* Write text, calculations, and annotations with the same ease as you would on paper or in a book.
* Annotate your calculations to avoid forgetting what they were about.
* Perform calculations such as addition <kbd>+</kbd>, subtraction <kbd>-</kbd>, division <kbd>÷</kbd>, multiplication <kbd>×</kbd>, percentage <kbd>%</kbd>, and power <kbd>^</kbd>.
* Create unlimited tapes using `+` button in tabs bar, switch between tapes using browser like tabs.
* View/Rename/Delete your saved tapes in the Bookmark menu, use the top left menu to view all tapes.
* Tapes will auto save, allowing you to pick up right where you left off.
* The numbers will auto format and auto indented as you type.
* Numbers are formatted according to your locale.
* You can define variables and use it in calculations.
* Hover cursor over variables to check it's value.
* Customize colors using the settings menu <img src="src/assets/gear.svg" width="20">, number of decimals to display and indent length can be changed too.
* Tape calculation doesn't use operator precedence, the results will be as you would type it on a calculator. 
```
       100.00
+      200.00
×        3.00
═════════════
       900.00
```
* Expressions use operator precedence. `myvar = 100 + 200 × 3` myvar is `700`.
* Decimal arithmetic preserves results such as [`0.1 + 0.2 = 0.3`](https://0.30000000000000004.com/); non-terminating division follows the documented finite, half-even precision fallback.
* Export your tape as PDF <img src="src/assets/pdf.svg" width="24">.

<br></br>
EITHER 

[Download QwikTape](https://github.com/4silvertooth/QwikTape/releases) from releases,

OR 
```bash
git clone --recurse-submodules https://github.com/4silvertooth/QwikTape.git
```
and run

[**`run-win.bat`**](run-win.bat) for windows
[**`sh run-linux.sh`**](run-linux.sh) for linux
[**`sh run-macosx.sh`**](run-macosx.sh) for macosx


# What's in a name?
QwikTape the name is inspired by [QuickJs](https://github.com/bellard/quickjs) used by [Sciter](https://gitlab.com/sciter-engine/sciter-js-sdk), the engine which powers this application, and [Tape](https://en.wikipedia.org/wiki/Punched_tape) which is what it used to be called for such documents. 

The logo is inspired by the [Rail-Road](http://htmlpreview.github.io/?https://github.com/4silvertooth/QwikTape/blob/main/build/railroad-diagram.htm) diagram the QwikTape grammar generates and a calculator.

[Chevrotain](https://github.com/Chevrotain/chevrotain) toolkit to build the parser.

Also inspired by [CalcTape](https://calctape.app/), [Numi](https://numi.app/), [Soulver](https://soulver.app/), [Calca](http://calca.io/)

# Keyboard Shortcuts
| | Windows/Linux | MacOs |
| :---:   | :---: | :---: |
| New Tape | <kbd>Ctrl</kbd>+<kbd>T</kbd> | <kbd>&#8984;</kbd>+<kbd>T</kbd> |
| New Tape | <kbd>Ctrl</kbd>+<kbd>N</kbd> | <kbd>&#8984;</kbd>+<kbd>N</kbd> |
| Switch Tapes | <kbd>Ctrl</kbd>+<kbd>Tab</kbd> | <kbd>&#8984;</kbd>+<kbd>Tab</kbd> |
| Close Tape | <kbd>Ctrl</kbd>+<kbd>W</kbd> | <kbd>&#8984;</kbd>+<kbd>W</kbd> |
| Clear Tape | <kbd>ESC</kbd> * | <kbd>ESC</kbd> * |

 *Select `Press ESC to clear tape content?` from settings to clear tape on pressing ESC. 

# FAQ
To execute linux binary after downloading use this command. 
```sh 
sudo chmod +x qwiktape
``` 

To execute macosx binary use this command. 
```sh
sudo chmod +x qwiktape
sudo xattr -d com.apple.quarantine qwiktape
```
### Relocating QwikTape to a Portable Location (e.g., a Pen Drive)
To move QwikTape to a portable location:

* Locate the `qwiktapes.db` file, typically found in the `Documents` folder of your operating system.
Move the `qwiktapes.db` file to the same directory as the QwikTape application executable.

* If QwikTape does not detect the `qwiktapes.db` file in the `Documents` folder, it will automatically search for the file in the same directory as the application executable.

# Mentions
[ilovefreesoftware](https://www.ilovefreesoftware.com/17/webware/free-virtual-notepad-for-windows-with-calculator-annotations-qwiktape.html) made a little tutorial to use QwikTape.

# Coming up.
* i18n

# Developers
QwikTape uses awesome Sciter SDK for its gui and chevrotain for the parser,

Clone the repo with submodules using,

```
git clone --recurse-submodules https://github.com/4silvertooth/QwikTape.git
```
Directory structure,

* `sdk` the sciter-js-sdk as a submodule

* `src` the source directory of the application
    * `assets` icons and logos
    * `components` all the reactor widgets
    * `chevrotain` the parser toolkit
    * `parser` the heart of it all
    * `storage` the database logic
    * <i>`main.htm`</i> the entry point
* `tests` all the tests goes in here
* `run-dev.html` for developers to debug and support in making changes.

Start developer mode by using,

[**`run-win.bat -dev`**](run-win.bat) for windows

[**`sh run-linux.sh -dev`**](run-linux.sh) for linux

[**`sh run-macosx.sh -dev`**](run-macosx.sh) for macosx

from the `prompt`, it will give you developer view of QwikTape with controls to help you make changes. It launches `scapp` from sciter-js-sdk with [run-dev.html](run-dev.html) in `--debug` mode. Use inspector to inspect.

Use,

* `Diagram` to produce rail-road diagram of the parser grammar.

* `Refresh` to refresh the application frame for any changes to css or html.

* `Tests` to bring up all the tests, run tests from the toolwindow.

* `Screen Shot` to capture the image of the main application. 

* `Build` to produce final builds.

* `Inspector` to open inspector for debugging 

* `Help` to open sciter sdk documentation

<br></br>
I've build all assets like icons and logos inside [`src/assets`](src/assets) in figma and are licensed under [CC](
https://creativecommons.org/licenses/by/4.0/).
