# Desktop Stage: Interactive Workspace and Recording

## Summary

Replace the current non-interactive desktop preview with a working virtual desktop inside an installable Windows/macOS app. Users will open and use apps, record either the whole virtual desktop or a selected rectangle, review the take, then apply a mouse-follow camera effect without recording again.

This is a functional simulation, not a macOS VM. A real macOS guest would not meet the cross-platform goal; [UTM supports macOS guests only on supported Apple Silicon Mac hosts](https://docs.getutm.app/guest-support/macos/).

## Key changes

- **Desktop runtime:** Package the existing React editor in Electron and add a separate, fixed-resolution stage window containing only the virtual desktop. Give it a dock, movable/resizable/focusable windows, keyboard focus, and a live pointer. Keep the existing animated-scene renderer for older projects rather than treating it as the interactive workspace.
- **Predefined apps:** Provide Finder (project-local virtual files), iTerm (a shell limited to those files), Arc (real website navigation through an isolated Chromium view), QuickTime (imported video/audio playback), and Photo Booth (an imported front-camera video placeholder). These are Desktop Stage implementations—not the original applications. [DaedalOS](https://github.com/DustinBrett/daedalOS) demonstrates reusable virtual-file and shell concepts, but will be a reference rather than a wholesale dependency.
- **App customization:** Default to the recognizable names, with per-project options for fictional or custom names and uploaded icons. Allow pasted HTML/CSS templates to replace an app’s appearance through documented content slots and built-in action bindings. Sanitize templates and isolate styles; do not execute pasted JavaScript or grant templates filesystem access.
- **Recording:** Capture only the stage window. “Full desktop” records its entire canvas; “selected area” fixes a rectangle before recording and crops frames *before saving*, so out-of-area pixels are not retained. In selected-area mode, a window wholly outside the rectangle stops receiving content input, but its title bar remains draggable back in; partially visible windows accept input only in the visible portion. Record timestamped pointer movement and clicks alongside video. Mix QuickTime/Photo Booth playback audio with an optional microphone; mute website audio during recording. Permission denial should leave video recording usable with a clear warning.
- **Review and mouse follow:** Save each take as video plus synchronized pointer metadata. Review it immediately, then toggle “Track mouse”: a 1.5× camera view follows the pointer with smoothing and stays within the recorded frame. This changes preview/export instructions, not the source video—no second recording is needed. Reuse the existing video export pipeline for an effect-applied MP4; retain the raw take for further edits. [OpenScreen’s MIT-licensed recording design](https://github.com/getopenscreen/openscreen/blob/main/website/docs/cli.md) is the reference for separate cursor metadata and post-recording camera effects.

## Project and platform integration

- Add versioned workspace settings, app customizations, virtual-file metadata, recording region, and take/effect manifests to the project format; keep video and imported-media bytes in the project’s media storage and archive. Preserve loading and rendering of existing projects.
- Use Electron’s isolated web-content view for sites and its [window-capture facilities](https://www.electronjs.org/docs/latest/api/desktop-capturer) for the stage. The capture must never silently fall back to recording the host screen. Browser pages get no Node access; site permissions and downloads require explicit handling. Electron’s [mouse-event hooks](https://www.electronjs.org/docs/latest/api/web-contents) provide pointer metadata even over embedded pages.
- First establish a capture proof on both Windows and macOS: verify that browser content, cursor, selected-area cropping, and controlled audio appear in the saved take. Resolve any platform-specific cursor behavior before building the full recording UI. macOS recording permissions and audio requirements must be surfaced in setup, not hidden after a failed take.

## Test plan

- Exercise each app’s core workflow, window stacking/dragging, virtual-file isolation, browser navigation, media playback, and custom-name/icon/template restoration.
- Record the same interaction in full and selected-area modes; verify the crop contains no outside pixels, out-of-area input rules work, clicks align with video frames, and stopping/restarting creates independent takes.
- Deny microphone or screen-recording permission, interrupt a recording, and import malformed templates/projects; verify clear errors and recoverable saved work.
- Compare review with exported MP4 for mouse-follow position, cursor visibility, timing, and audio sync. Run unit tests, build/type checks, and packaged-app smoke tests on Windows and macOS.

## Assumptions

The first milestone includes recording, review, mouse-follow, and take export, but not editing every live app interaction as separate timeline actions. The virtual terminal cannot execute host commands; the browser is Chromium with an Arc-style interface, not the Arc binary. Custom interface code is HTML/CSS only in this milestone; executable app plugins are a later, separately secured feature.
