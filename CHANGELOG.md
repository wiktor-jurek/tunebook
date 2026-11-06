# Changelog

## [1.0.0](https://github.com/wiktor-jurek/tunebook/compare/v0.2.0...v1.0.0) (2026-11-06)


### ⚠ BREAKING CHANGES

* MCP tool names change from libresession_* to tunecompanion_*.

### Features

* a calmer landing page, one design system and practice anywhere ([78ee342](https://github.com/wiktor-jurek/tunebook/commit/78ee3420ca3396a8f0a7e35209757855b811f4db))
* add emoji icons to tunebooks ([ff456ed](https://github.com/wiktor-jurek/tunebook/commit/ff456ed117ca5d1ed2b72db32f23ed5c90f1f78c))
* add tunebook contents and collapsible scores ([a847364](https://github.com/wiktor-jurek/tunebook/commit/a8473649124ea0d8e20329fc296115bb4e7f0f3a))
* add tunes inline with a setting chooser ([edf7ab4](https://github.com/wiktor-jurek/tunebook/commit/edf7ab4003f263c1d91e21b3a6ca451ad05dbcf7))
* **analytics:** identify users and track MCP, search and OAuth in Umami ([8e95159](https://github.com/wiktor-jurek/tunebook/commit/8e9515954236675b764540666ef3baf6d47b5605))
* **analytics:** track Libresession usage with Umami ([d33bce8](https://github.com/wiktor-jurek/tunebook/commit/d33bce83bfe690b10869a94976a71d29f2a8cd3b))
* **android:** choose light or dark in settings, and fix black text in dark mode ([d9d247f](https://github.com/wiktor-jurek/tunebook/commit/d9d247fffc8437ba785a71bf6f268110371a746b))
* **android:** deck, session recorder and waveform, sessions, practice and Me passport ([84c651e](https://github.com/wiktor-jurek/tunebook/commit/84c651e45e1eedf4b3799685615977101f939a75))
* **benchmark:** add Cadence to the tune finder benchmark ([e20a668](https://github.com/wiktor-jurek/tunebook/commit/e20a6684e712fc4def278002fbbfcbc00aadbf7a))
* **brand:** new Tunebook mark for the favicon, app icons and header ([6d2e78b](https://github.com/wiktor-jurek/tunebook/commit/6d2e78becb2cacd3d2ca5cea60d210ee0425bf3b))
* combine sidebar creation actions into one row ([705d3d8](https://github.com/wiktor-jurek/tunebook/commit/705d3d8ddaa2dd3175e890b5e7e6bc21ce8cfc7d))
* edit tunebook icons from a responsive popover ([a7bc9b2](https://github.com/wiktor-jurek/tunebook/commit/a7bc9b28eebeebbee0d1f4db28eaf220ad1292aa))
* **finder:** add octave height channels to the browser front end ([afc8234](https://github.com/wiktor-jurek/tunebook/commit/afc82349fc16e30ec007240a1a49f6fa9eaaf07a))
* **finder:** decoder update in web and listen-core, with tests ([d1f3564](https://github.com/wiktor-jurek/tunebook/commit/d1f3564d270fc2cdfe4ce58b408ffb24b2935f79))
* **finder:** name nothing while the leader scores under 0.35 ([03ad06d](https://github.com/wiktor-jurek/tunebook/commit/03ad06dc1d9298cf96bc0bab17ca98db7aed0759))
* **finder:** serve the tune finder's model from the bucket in production ([6e25124](https://github.com/wiktor-jurek/tunebook/commit/6e2512475b6674e814763a32d75eb89cc289ee6b))
* **guides:** first session tunes, popular sets and tune finder apps compared ([dddf4b4](https://github.com/wiktor-jurek/tunebook/commit/dddf4b4858216fa540bc81372f5af7bf0273a091))
* **guides:** link the official tunebooks ([2d05a63](https://github.com/wiktor-jurek/tunebook/commit/2d05a639a2b6b1ac390e2dc163ef30db94a7514a))
* **ios:** sessions, docked deck, native score playback and Me passport ([1d23583](https://github.com/wiktor-jurek/tunebook/commit/1d23583cfb749241e2a96d65a2610e7df7fd28e6))
* **labeller:** add Cadence guide lanes, and lanes for SoundCloud sessions ([302914f](https://github.com/wiktor-jurek/tunebook/commit/302914fd972245924b9c5f62de74a531841b8545))
* **labeller:** right-click the waveform to start a new tune ([fd2eb14](https://github.com/wiktor-jurek/tunebook/commit/fd2eb144394c2418673753be90780389dde5336c))
* **landing:** lead with the whole loop, learn at home and play at the session ([353bf72](https://github.com/wiktor-jurek/tunebook/commit/353bf720e418888187740eed1c2299825649f279))
* **landing:** tell the listen, learn and play story with phone hero stage ([920083f](https://github.com/wiktor-jurek/tunebook/commit/920083fcf5f6a9b399091a9b585455e0aab44fa5))
* **listen:** add melody extraction and symbolic matching for Listen ([6134c56](https://github.com/wiktor-jurek/tunebook/commit/6134c569febb7ccfcc2a7390bc7c5b1e71f01cdd))
* **mcp:** add OAuth-protected MCP server for AI agents ([d9cff38](https://github.com/wiktor-jurek/tunebook/commit/d9cff38e72f233e2e835e11b8d8f394a04b83fe1))
* **ml:** add SoundCloud sessions, and write found songs to the data home ([d303263](https://github.com/wiktor-jurek/tunebook/commit/d3032639d65d62615053eb891941a83ceb8cb881))
* **ml:** add the Listen training and evaluation project ([5c58dc9](https://github.com/wiktor-jurek/tunebook/commit/5c58dc9763fdaad2021d24fb26c7e380fffbf268))
* **ml:** label play-alongs by what Gemini hears and add an ACE-Step cover pilot ([d228210](https://github.com/wiktor-jurek/tunebook/commit/d228210f7ce1f3ae7222c1cde9ba66e7851c34a9))
* **ml:** publish and back up play-alongs from the second YuE2 training run ([4d1d779](https://github.com/wiktor-jurek/tunebook/commit/4d1d779a452fe3419fca3e8b3e84038bcc1a8636))
* **ml:** session labelling and track store updates ([94faf10](https://github.com/wiktor-jurek/tunebook/commit/94faf10f9f6dc53635a4bdafd7df4ee46916e223))
* **ml:** third YuE2 training run covering every unrendered setting ([6ef15d2](https://github.com/wiktor-jurek/tunebook/commit/6ef15d2af67ae69dd61999f0de907467d3cc5598))
* **ml:** train the classifier on YuE2 performances and re-rank with alignment ([93f636d](https://github.com/wiktor-jurek/tunebook/commit/93f636d62c32a2ab1398b003e84fd9d97a9c687d))
* **ml:** training data store, labeller and admin pages ([b09f2f2](https://github.com/wiktor-jurek/tunebook/commit/b09f2f25ef8b40c80ed393e7dde60e8bfe753722))
* monorepo layout with shared Rust listen-core, iOS and Android apps ([52c21f5](https://github.com/wiktor-jurek/tunebook/commit/52c21f505a72ebef17abd70e71a947f7d319aac9))
* move to tunecompanion.com ([e130067](https://github.com/wiktor-jurek/tunebook/commit/e130067e27e7548d0e8edb0797add867f30ed18c))
* **notation:** engraving and parsing fixes ([8354f62](https://github.com/wiktor-jurek/tunebook/commit/8354f62e6a8ce6f875470794fa62318f0501c04c))
* **notation:** further engraving, parsing and timeline changes ([990a7a3](https://github.com/wiktor-jurek/tunebook/commit/990a7a31bb760170d1daa520db008d7118de6430))
* **notation:** native scores replace abcjs on iOS and Android ([6a55e85](https://github.com/wiktor-jurek/tunebook/commit/6a55e85350f55bdc476e5adf47c84fb33f374006))
* **notation:** notation-core crate behind listen-ffi ([058fd85](https://github.com/wiktor-jurek/tunebook/commit/058fd85e995b3040696da2de112897aa44313f63))
* **playalong:** follow the score while a play-along plays ([d21ce85](https://github.com/wiktor-jurek/tunebook/commit/d21ce851eaf865ca3d9f82a00e7af34b2f44119e))
* **playalong:** offer play-alongs from other settings of a tune in the same key ([df6b4b8](https://github.com/wiktor-jurek/tunebook/commit/df6b4b899b4871402ba0f2fde7213638ab58c5e3))
* **playalong:** pick play-alongs with buttons instead of the sound menu ([faa1fc7](https://github.com/wiktor-jurek/tunebook/commit/faa1fc717ca1a18ba3c7c14716e0de55083c7cb9))
* **playalong:** play generated play-along recordings on tune pages ([bc35180](https://github.com/wiktor-jurek/tunebook/commit/bc35180bbfdc5f696d42774b14cede8479406a78))
* **playalong:** show play-alongs on tunebook pages ([32de3c7](https://github.com/wiktor-jurek/tunebook/commit/32de3c73791e6737cadb510cbf812f63b16dfac2))
* **practice:** a floating tune finder dock, and a timeline that names its tunes ([5446d11](https://github.com/wiktor-jurek/tunebook/commit/5446d11be94c2b3d87a6a4709346076f7d3a2f53))
* **practice:** sidebar of equals, and a tunes table that narrows gracefully ([da52c04](https://github.com/wiktor-jurek/tunebook/commit/da52c04e09aaf2a4195cc21c6d9147a5b74d0d7e))
* **practice:** track tune ability and playable book progress ([3f3ab36](https://github.com/wiktor-jurek/tunebook/commit/3f3ab360318e36623b2cc96af97742be676f9996))
* **recordings:** one list, with uploads you can watch arrive ([96888b7](https://github.com/wiktor-jurek/tunebook/commit/96888b74e125a9a07560020ecd9793ca834e2ace))
* replace manage form with focused library actions ([b717bef](https://github.com/wiktor-jurek/tunebook/commit/b717bef59f6f207d99e17c7dc209a1f8fd08127f))
* save preferred default playback sound ([dbddc11](https://github.com/wiktor-jurek/tunebook/commit/dbddc1188ad0fbb1afe50334669886c2cf5ce96c))
* **session:** a live session stays folded, with the tune playing now in the deck ([de1b150](https://github.com/wiktor-jurek/tunebook/commit/de1b1509c6e6dc826bcd3ae4d508afa4dcb1d1d7))
* **session:** a Tunes tab, and recordings that show what you could join in on ([2a1b0b5](https://github.com/wiktor-jurek/tunebook/commit/2a1b0b5721379729627c6a3d67d1149a9fc495c5))
* **session:** calmer springs, and a microphone that becomes the record dot ([81cee4a](https://github.com/wiktor-jurek/tunebook/commit/81cee4a26634e20d91421792f3ae6b6f7746329b))
* **session:** give the deck and its microphone a little bounce ([2305736](https://github.com/wiktor-jurek/tunebook/commit/23057369ef55937bef09680b050568d2d03f247d))
* **session:** live setlist that peeks, opens any tune, and learns from swipes ([0f1273b](https://github.com/wiktor-jurek/tunebook/commit/0f1273b526c704921235d4e713927ef7f4cffeb2))
* **session:** one fluid sheet, with the mic growing into the record button ([ba0f708](https://github.com/wiktor-jurek/tunebook/commit/ba0f708250fca11f8a80bac759f7c1f9357870b4))
* **session:** practice and session modes, listen deck and session recordings ([c88725d](https://github.com/wiktor-jurek/tunebook/commit/c88725da039f6d00c932eaa3fb717ca810610fe1))
* **sessions:** upload a recording on web, iOS and Android ([681970d](https://github.com/wiktor-jurek/tunebook/commit/681970d1643db4de9468cdfa00199277027f3d79))
* **session:** the deck asks What's playing?, and offers to expand to record a full session ([2209c63](https://github.com/wiktor-jurek/tunebook/commit/2209c63ad449b83f669da8f723283ef69928f017))
* **session:** waiting uploads move to Recordings, and the tray's search is a Quick search ([693451f](https://github.com/wiktor-jurek/tunebook/commit/693451f469c9186daa2c04f63532b69aa9fc2038))
* **sets:** a set lives in its session's tunebook, and recordings find them ([cf3d864](https://github.com/wiktor-jurek/tunebook/commit/cf3d86463d5ed9de9e110ef8e7114df992445ede))
* **sets:** add reusable ordered tune sets ([3578d11](https://github.com/wiktor-jurek/tunebook/commit/3578d11a70857a795cbc1292a2582d27c23e8e9b))
* **sets:** default names to tunes in playing order ([fff1009](https://github.com/wiktor-jurek/tunebook/commit/fff1009e1736efa63b9ada32b29cfa4b0acc3110))
* share tunebooks by email and public link ([6872f19](https://github.com/wiktor-jurek/tunebook/commit/6872f1949d24720b72efd276e8e07794683c3532))
* simplify sidebar creation with contextual menus ([63ba4ea](https://github.com/wiktor-jurek/tunebook/commit/63ba4ea31579dedb766356850adaf2a75379e86a))
* toggle tunebook membership from a checked dropdown ([1a51a24](https://github.com/wiktor-jurek/tunebook/commit/1a51a2439782ebb7658bb7dfbbbb6246a36023ff))
* **tunebooks:** add session-bound often played tunes ([5e0d281](https://github.com/wiktor-jurek/tunebook/commit/5e0d2819afc6321c075a8547baa67a65b402b5d7))
* **tunes:** a strip of groups to jump through a long list ([93963dd](https://github.com/wiktor-jurek/tunebook/commit/93963ddc8076ee1b78b778c71551d93aab063118))
* **tunes:** add cached smart emoji suggestions ([8cd7620](https://github.com/wiktor-jurek/tunebook/commit/8cd7620472e1ff01bf6e0e59ee67528774a2ed21))
* **tunes:** add semantic emoji matching with local embeddings ([4a1fe5d](https://github.com/wiktor-jurek/tunebook/commit/4a1fe5de32ebe79eed80ac7bc759cbd8c889ffcc))
* **tunes:** group your tunes by stage of learning, key or type ([849ec67](https://github.com/wiktor-jurek/tunebook/commit/849ec678d7a8a7f6249c65d07918d520967be871))
* **tunes:** search, filter and sort the library as a table ([a8acb9c](https://github.com/wiktor-jurek/tunebook/commit/a8acb9c1203484b0440058fbdca58b5130825da3))
* **tunes:** tunebooks become a way to group your tunes, with a lighter header ([f42877a](https://github.com/wiktor-jurek/tunebook/commit/f42877a8823f85fe937c9cdfdb7b6a064bc79c28))
* **ui:** pick-one menus that match the app, in place of the browser's selects ([ac1cd4b](https://github.com/wiktor-jurek/tunebook/commit/ac1cd4b376574ff3d9610b53e47c4b32be58a84f))
* **ui:** show that a page is on its way ([4a42b82](https://github.com/wiktor-jurek/tunebook/commit/4a42b825741c13530234f4a89b25bc310bbd2a0d))
* unify tune search and match across title, type and key ([507b858](https://github.com/wiktor-jurek/tunebook/commit/507b85832923fa4df4c7fbb89da19248a5559bfe))
* **web:** sessions instead of recordings, and a Me passport ([e494c3e](https://github.com/wiktor-jurek/tunebook/commit/e494c3efc56cafe9efa845e4902004140b48c3cf))


### Bug Fixes

* **android:** keep ONNX Runtime classes so release builds can listen ([c7819ab](https://github.com/wiktor-jurek/tunebook/commit/c7819ab4ba7e85f941597752d32588f3d719ddeb))
* display each tune title once above the score ([6820f7d](https://github.com/wiktor-jurek/tunebook/commit/6820f7d903ca704dd2105244d134e792b4808cc0))
* **finder:** use the channel count the web model takes ([053af76](https://github.com/wiktor-jurek/tunebook/commit/053af761b5ad8ca035d8c1c62f87d0e272c279c9))
* **listen:** keep rests in exported melodies and publish training clips as play-alongs ([ee4cc50](https://github.com/wiktor-jurek/tunebook/commit/ee4cc50fce577eb95e3160408cadf824a40c211c))
* **ml:** end each YuE2 melody note where the next begins, and plainer line-ups ([5dd9a58](https://github.com/wiktor-jurek/tunebook/commit/5dd9a5845f313c5e6a90753b7954f849ba7640b4))
* **passport:** mark newly earned stamps after hydration ([5f92bd0](https://github.com/wiktor-jurek/tunebook/commit/5f92bd07422de5337153968ca58f8ac97cd77b09))
* **playalong:** import play-alongs in chunks under Postgres's parameter limit ([e4b72ca](https://github.com/wiktor-jurek/tunebook/commit/e4b72ca3f864330ebf53921f01d82efe93ff56ec))
* **practice:** the dock stays in its corner, with its microphone in step ([1790c91](https://github.com/wiktor-jurek/tunebook/commit/1790c91801047ecbb114fc4c0ec423d0c82abb97))
* robots.txt, sitemap and link previews follow the new domain and copy ([276a5f4](https://github.com/wiktor-jurek/tunebook/commit/276a5f4401cc3840eb6ea3f0bf5792d57d884376))
* **session:** flicking the deck never glitches, and the dock's microphone sits centred ([04160a1](https://github.com/wiktor-jurek/tunebook/commit/04160a1d0e4e38e8ef1ec3ae822948d85941146a))
* **session:** name a tune without the sheet jumping, and say where it stands ([36b76b9](https://github.com/wiktor-jurek/tunebook/commit/36b76b900c33b8b343dd31a270482691d0c484f8))
* **session:** smooth the listen deck with Motion springs ([ccc3c04](https://github.com/wiktor-jurek/tunebook/commit/ccc3c047677494733b125d1755cd93526e318dd5))
* **session:** the record button no longer floats over the tray's header, and Heard reads cleanly ([43913a3](https://github.com/wiktor-jurek/tunebook/commit/43913a35c6f2d6623669bef4e419a069242e0579))
* **tunes:** the group strip shows there is more past its ends ([5320288](https://github.com/wiktor-jurek/tunebook/commit/5320288ec2cb199a43aaf5a4a60d29fd6d78a550))


### Performance Improvements

* **ml:** decode YuE2 clips in batches, about 2.7x more clips per GPU ([ced372a](https://github.com/wiktor-jurek/tunebook/commit/ced372a8911d10a59509cab91126aeefac0b36bd))


### Code Refactoring

* drop the Libresession name ([c2a053c](https://github.com/wiktor-jurek/tunebook/commit/c2a053c710da514557a35b6caf22b725fee05b53))

## [0.2.0](https://github.com/wiktor-jurek/tunebook/compare/v0.1.0...v0.2.0) (2026-09-25)


### Features

* create personal tunebook app ([b292855](https://github.com/wiktor-jurek/tunebook/commit/b292855c5aa2d18009d64b7b88a145ee83953dcb))


### Bug Fixes

* keep internal errors private before public release ([a10bf77](https://github.com/wiktor-jurek/tunebook/commit/a10bf77aa28de9f83c2c7b741090b52dce130c65))
