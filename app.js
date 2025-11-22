/**
 * Piano Learning App
 * Main Application Logic
 */

class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.5;
        this.masterGain.connect(this.ctx.destination);

        this.metronomeGain = this.ctx.createGain();
        this.metronomeGain.gain.value = 0.5;
        this.metronomeGain.connect(this.ctx.destination);

        this.activeOscillators = new Map(); // Map<NoteNumber, {osc, gain}>
    }

    setPianoVolume(value) {
        // value 0-100
        this.masterGain.gain.value = value / 100;
    }

    setMetronomeVolume(value) {
        // value 0-100
        this.metronomeGain.gain.value = value / 100;
    }

    playNote(noteNumber, velocity = 127) {
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        // Stop existing note if playing
        this.stopNote(noteNumber);

        const freq = 440 * Math.pow(2, (noteNumber - 69) / 12);

        const osc = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();

        osc.type = 'triangle'; // Softer than square/sawtooth
        osc.frequency.value = freq;

        // Velocity handling
        const vol = (velocity / 127);
        gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.5); // Decay

        osc.connect(gainNode);
        gainNode.connect(this.masterGain);

        osc.start();

        // Auto cleanup
        osc.stop(this.ctx.currentTime + 1.5);
        setTimeout(() => {
            if (this.activeOscillators.get(noteNumber)?.osc === osc) {
                this.activeOscillators.delete(noteNumber);
            }
        }, 1500);

        this.activeOscillators.set(noteNumber, { osc, gain: gainNode });
    }

    stopNote(noteNumber) {
        const active = this.activeOscillators.get(noteNumber);
        if (active) {
            // Quick release
            active.gain.gain.cancelScheduledValues(this.ctx.currentTime);
            active.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
            active.osc.stop(this.ctx.currentTime + 0.1);
            this.activeOscillators.delete(noteNumber);
        }
    }
}

class MidiEngine {
    constructor(audioEngine, ui) {
        this.audioEngine = audioEngine;
        this.ui = ui;
        this.midiAccess = null;
        this.inputs = [];
    }

    async init() {
        console.log("MidiEngine: Initializing...");
        if (!navigator.requestMIDIAccess) {
            console.warn("Web MIDI API not supported in this browser.");
            this.ui.updateMidiSelect([]);
            return;
        }

        try {
            console.log("MidiEngine: Requesting access...");
            this.midiAccess = await navigator.requestMIDIAccess();
            console.log("MidiEngine: Access granted", this.midiAccess);
            this.midiAccess.onstatechange = (e) => this.onStateChange(e);
            this.updateInputs();
        } catch (err) {
            console.error("MIDI Access Failed", err);
            // Check if running on file://
            if (window.location.protocol === 'file:') {
                alert("MIDI access may be blocked when running from a local file. Please try running a local server (e.g., 'npx serve' or VS Code Live Server).");
            } else {
                alert("MIDI access denied or failed. Please check permissions.");
            }
        }
    }

    updateInputs() {
        this.inputs = Array.from(this.midiAccess.inputs.values());
        console.log("MidiEngine: Inputs found:", this.inputs.length, this.inputs);
        this.ui.updateMidiSelect(this.inputs);

        // Auto-connect to first input
        this.inputs.forEach(input => {
            input.onmidimessage = (e) => this.handleMidiMessage(e);
        });
    }

    onStateChange(e) {
        console.log("MIDI State Change", e);
        this.updateInputs();
    }

    handleMidiMessage(e) {
        const [command, note, velocity] = e.data;
        const cmd = command >> 4;

        if (cmd === 9 && velocity > 0) { // Note On
            this.audioEngine.playNote(note, velocity);
            this.ui.highlightKey(note, true);
        } else if (cmd === 8 || (cmd === 9 && velocity === 0)) { // Note Off
            this.audioEngine.stopNote(note);
            this.ui.highlightKey(note, false);
        }
    }
}



class AppUI {
    constructor() {
        this.pianoContainer = document.getElementById('piano');
        this.midiSelect = document.getElementById('midi-input');
        this.chordTimeline = document.getElementById('chord-timeline');
        this.notificationToast = document.getElementById('notification-toast');
        this.keyMap = new Map(); // noteNumber -> DOM Element
        this.renderPiano();
        this.dragLocked = true; // Default locked
    }

    renderPiano() {
        const startNote = 48; // C3
        const endNote = 84; // C6
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        for (let i = startNote; i <= endNote; i++) {
            const isBlack = [1, 3, 6, 8, 10].includes(i % 12);
            const noteName = noteNames[i % 12];
            const key = document.createElement('div');
            key.className = `key ${isBlack ? 'key-black' : 'key-white'}`;
            key.dataset.note = i;
            key.dataset.noteName = noteName;

            // Mouse interaction
            key.addEventListener('mousedown', () => window.app.playNote(i));
            key.addEventListener('mouseup', () => window.app.stopNote(i));
            key.addEventListener('mouseleave', () => window.app.stopNote(i));

            this.pianoContainer.appendChild(key);
            this.keyMap.set(i, key);
        }
    }

    toggleKeyLabels(show) {
        if (show) {
            this.pianoContainer.classList.add('show-labels');
        } else {
            this.pianoContainer.classList.remove('show-labels');
        }
    }

    showNotification(message) {
        this.notificationToast.textContent = message;
        this.notificationToast.classList.add('show');
        setTimeout(() => {
            this.notificationToast.classList.remove('show');
        }, 2000);
    }

    updateMidiSelect(inputs) {
        if (!this.midiSelect) return;
        this.midiSelect.innerHTML = '';
        if (inputs.length === 0) {
            const opt = document.createElement('option');
            opt.text = "No MIDI Devices Found";
            this.midiSelect.add(opt);
            return;
        }

        inputs.forEach(input => {
            const opt = document.createElement('option');
            opt.value = input.id;
            opt.text = input.name;
            this.midiSelect.add(opt);
        });
    }

    highlightKey(note, isActive, type = 'manual') {
        const key = this.keyMap.get(note);
        if (key) {
            // Remove all active classes first to avoid conflicts
            key.classList.remove('active', 'manual', 'auto');

            if (isActive) {
                key.classList.add('active', type);
            }
        }
    }

    clearManualHighlights() {
        this.keyMap.forEach(key => {
            if (key.classList.contains('manual')) {
                key.classList.remove('active', 'manual');
            }
        });
    }

    addChordToTimeline(chord, index) {
        const emptyState = this.chordTimeline.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const chordEl = document.createElement('div');
        chordEl.className = 'chord-item';
        if (window.app.selectedChordIndices.has(index)) {
            chordEl.classList.add('selected');
        }

        // Set width based on duration (1 beat = 60px)
        const duration = chord.duration || 4;
        const widthPerBeat = 60;
        chordEl.style.width = `${duration * widthPerBeat}px`;

        if (chord.type === 'rest') {
            chordEl.classList.add('rest');
            chordEl.textContent = 'Rest';
        } else {
            chordEl.innerHTML = `${chord.name}<span class="inversion-indicator">${this.getInversionLabel(chord.inversion)}</span>`;
        }

        chordEl.draggable = true;
        chordEl.dataset.index = index;

        // Hover Preview
        chordEl.addEventListener('mouseenter', () => {
            if (!window.app.isPlaying) {
                window.app.previewChord(index, true);
            }
        });

        chordEl.addEventListener('mouseleave', () => {
            if (!window.app.isPlaying) {
                window.app.previewChord(index, false);
            }
        });

        // Click to Move Playhead & Select
        chordEl.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent timeline click

            // Move Playhead
            window.app.currentChordIndex = index;
            this.setPlaybackPosition(index);

            // Selection Logic
            if (e.ctrlKey || e.metaKey) {
                window.app.toggleSelection(index);
            } else if (e.shiftKey) {
                // Range select from last selected to current
                const lastSelected = Array.from(window.app.selectedChordIndices).pop();
                if (lastSelected !== undefined) {
                    window.app.selectRange(lastSelected, index);
                } else {
                    window.app.selectChord(index);
                }
            } else {
                window.app.selectChord(index);
            }
        });

        // Drag Events
        chordEl.addEventListener('dragstart', (e) => {
            e.stopPropagation(); // Prevent section drag
            chordEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
            window.app.dragStartIndex = index;

            // If dragging an unselected chord, select it (and deselect others unless ctrl)
            if (!window.app.selectedChordIndices.has(index)) {
                window.app.selectChord(index);
            }
        });

        chordEl.addEventListener('dragend', (e) => {
            e.stopPropagation();
            chordEl.classList.remove('dragging');
        });

        // Context Menu (Right Click)
        chordEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // If right-clicking outside selection, select only this chord
            if (!window.app.selectedChordIndices.has(index)) {
                window.app.selectChord(index);
            }

            this.showContextMenu(e, index);
        });

        this.chordTimeline.appendChild(chordEl);
    }

    showContextMenu(e, index) {
        const menu = document.getElementById('context-menu');
        if (!menu) return;

        // Position menu
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;

        // Setup Menu Actions
        // Clear previous listeners to avoid duplicates (simple approach: clone node)
        const newMenu = menu.cloneNode(true);
        menu.parentNode.replaceChild(newMenu, menu);

        // Re-attach listeners
        newMenu.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (ev) => {
                const action = item.dataset.action;
                const value = item.dataset.value;

                if (action === 'copy') window.app.copySelection();
                else if (action === 'cut') window.app.cutSelection();
                else if (action === 'paste') window.app.pasteSelection();
                else if (action === 'delete') window.app.deleteSelection();
                else if (action && value) window.app.updateSelectedChords(action, value);

                this.hideContextMenu();
            });
        });

        // Close on click outside
        const closeMenu = () => {
            this.hideContextMenu();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    hideContextMenu() {
        const menu = document.getElementById('context-menu');
        if (menu) menu.style.display = 'none';
    }

    updateSelectionVisuals() {
        const chordEls = document.querySelectorAll('.chord-item');
        chordEls.forEach(el => {
            const index = parseInt(el.dataset.index);
            if (window.app.selectedChordIndices.has(index)) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });
    }

    getInversionLabel(inv) {
        if (!inv) return '';
        return inv === 1 ? '1st Inv' : inv === 2 ? '2nd Inv' : '';
    }

    setupTimelineDrag() {
        this.chordTimeline.addEventListener('dragover', (e) => {
            e.preventDefault(); // Allow dropping
            const afterElement = this.getDragAfterElement(this.chordTimeline, e.clientX);
            const draggable = document.querySelector('.dragging');
            if (draggable) {
                if (afterElement == null) {
                    this.chordTimeline.appendChild(draggable);
                } else {
                    this.chordTimeline.insertBefore(draggable, afterElement);
                }
            }
        });

        this.chordTimeline.addEventListener('drop', (e) => {
            e.preventDefault();
            // Re-calculate order based on DOM
            const newOrderIndices = Array.from(this.chordTimeline.children)
                .filter(el => el.classList.contains('chord-item'))
                .map(el => parseInt(el.dataset.index));

            window.app.reorderChords(newOrderIndices);
        });
    }

    setDragLock(locked) {
        this.dragLocked = locked;
        const sections = document.querySelectorAll('.draggable-section');
        sections.forEach(section => {
            section.draggable = !locked;
            section.style.cursor = locked ? 'default' : 'grab';
        });
    }

    setupSectionDrag() {
        const main = document.getElementById('main-content');
        if (!main) return;
        const sections = document.querySelectorAll('.draggable-section');

        // Initialize state
        this.setDragLock(true);

        sections.forEach(section => {
            section.addEventListener('dragstart', (e) => {
                if (this.dragLocked) {
                    e.preventDefault();
                    return;
                }
                if (e.target.classList.contains('chord-item')) return;
                section.classList.add('dragging-section');
                e.dataTransfer.effectAllowed = 'move';
            });

            section.addEventListener('dragend', () => {
                section.classList.remove('dragging-section');
            });
        });

        main.addEventListener('dragover', (e) => {
            if (this.dragLocked) return;
            e.preventDefault();
            const draggable = document.querySelector('.dragging-section');
            if (!draggable) return;

            const afterElement = this.getSectionDragAfterElement(main, e.clientY);
            if (afterElement == null) {
                main.appendChild(draggable);
            } else {
                main.insertBefore(draggable, afterElement);
            }
        });
    }

    getSectionDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.draggable-section:not(.dragging-section)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    getDragAfterElement(container, x) {
        const draggableElements = [...container.querySelectorAll('.chord-item:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    setupSelectionDrag() {
        let isSelecting = false;
        let startX = 0;
        let selectionBox = document.createElement('div');
        selectionBox.className = 'selection-box';
        document.body.appendChild(selectionBox);

        this.chordTimeline.addEventListener('mousedown', (e) => {
            // Only start if clicking on background (not chord, not marker)
            if (e.target.closest('.chord-item') || e.target.closest('.timeline-marker')) return;

            isSelecting = true;
            startX = e.pageX;

            // Initial box style
            selectionBox.style.display = 'block';
            selectionBox.style.left = `${startX}px`;
            selectionBox.style.top = `${this.chordTimeline.getBoundingClientRect().top}px`;
            selectionBox.style.height = `${this.chordTimeline.offsetHeight}px`;
            selectionBox.style.width = '0px';

            if (!e.ctrlKey && !e.metaKey) {
                window.app.deselectAll();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!isSelecting) return;

            const currentX = e.pageX;
            const width = Math.abs(currentX - startX);
            const left = Math.min(currentX, startX);

            selectionBox.style.width = `${width}px`;
            selectionBox.style.left = `${left}px`;

            // Select chords intersecting with box
            const boxRect = selectionBox.getBoundingClientRect();
            const chords = document.querySelectorAll('.chord-item');

            chords.forEach(chord => {
                const chordRect = chord.getBoundingClientRect();
                const index = parseInt(chord.dataset.index);

                // Simple intersection check (horizontal)
                if (chordRect.left < boxRect.right && chordRect.right > boxRect.left) {
                    window.app.selectChord(index, true); // Multi-select
                }
            });
        });

        document.addEventListener('mouseup', () => {
            if (isSelecting) {
                isSelecting = false;
                selectionBox.style.display = 'none';
            }
        });
    }

    clearTimeline() {
        this.chordTimeline.innerHTML = '<div class="empty-state">No chords added yet. Press a button above to start.</div>';
        this.removeMarkers();
    }

    refreshTimeline(chords) {
        this.chordTimeline.innerHTML = '';
        if (chords.length === 0) {
            this.clearTimeline();
        } else {
            chords.forEach((chord, index) => {
                this.addChordToTimeline(chord, index);
            });
            this.renderMarkers();
        }
        this.updatePlaybackBar(chords.length);
    }

    // Marker Logic
    renderMarkers() {
        this.removeMarkers();

        // Create markers
        this.playHead = this.createMarker('play-head', 'Play');
        this.loopStart = this.createMarker('loop-start', 'Start');
        this.loopEnd = this.createMarker('loop-end', 'End');

        this.chordTimeline.appendChild(this.playHead);
        this.chordTimeline.appendChild(this.loopStart);
        this.chordTimeline.appendChild(this.loopEnd);

        this.updateMarkerPositions();
        this.setupMarkerDrag(this.playHead, 'playHead');
        this.setupMarkerDrag(this.loopStart, 'loopStart');
        this.setupMarkerDrag(this.loopEnd, 'loopEnd');
    }

    createMarker(className, title) {
        const marker = document.createElement('div');
        marker.className = `timeline-marker ${className}`;
        marker.title = title;
        const head = document.createElement('div');
        head.className = 'marker-head';
        marker.appendChild(head);
        return marker;
    }

    removeMarkers() {
        const markers = this.chordTimeline.querySelectorAll('.timeline-marker');
        markers.forEach(m => m.remove());
    }

    updateMarkerPositions() {
        if (!window.app || window.app.chords.length === 0) return;

        const chords = Array.from(this.chordTimeline.querySelectorAll('.chord-item'));
        if (chords.length === 0) return;

        const getPos = (index) => {
            if (index >= chords.length) {
                const last = chords[chords.length - 1];
                return last.offsetLeft + last.offsetWidth;
            }
            return chords[index].offsetLeft;
        };

        if (this.playHead) this.playHead.style.left = getPos(window.app.currentChordIndex) + 'px';
        if (this.loopStart) this.loopStart.style.left = getPos(window.app.playRange.start) + 'px';
        if (this.loopEnd) this.loopEnd.style.left = getPos(window.app.playRange.end + 1) + 'px'; // End is inclusive, so marker goes after
    }

    setupMarkerDrag(marker, type) {
        let isDragging = false;

        marker.addEventListener('mousedown', (e) => {
            isDragging = true;
            e.stopPropagation();
            marker.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();

            const timelineRect = this.chordTimeline.getBoundingClientRect();
            const relativeX = e.clientX - timelineRect.left + this.chordTimeline.scrollLeft;

            // Find nearest chord gap
            const chords = Array.from(this.chordTimeline.querySelectorAll('.chord-item'));
            let closestIndex = 0;
            let minDist = Infinity;

            // Check start of each chord
            chords.forEach((chord, i) => {
                const dist = Math.abs(relativeX - chord.offsetLeft);
                if (dist < minDist) {
                    minDist = dist;
                    closestIndex = i;
                }
            });

            // Check end of last chord
            if (chords.length > 0) {
                const last = chords[chords.length - 1];
                const endDist = Math.abs(relativeX - (last.offsetLeft + last.offsetWidth));
                if (endDist < minDist) {
                    closestIndex = chords.length;
                }
            }

            if (type === 'playHead') {
                window.app.currentChordIndex = Math.min(closestIndex, chords.length - 1);
                if (window.app.currentChordIndex < 0) window.app.currentChordIndex = 0;
            } else if (type === 'loopStart') {
                window.app.playRange.start = Math.min(closestIndex, window.app.playRange.end);
            } else if (type === 'loopEnd') {
                window.app.playRange.end = Math.max(closestIndex - 1, window.app.playRange.start);
            }

            this.updateMarkerPositions();
            window.app.updateRangeInputs();
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                marker.style.cursor = 'ew-resize';
            }
        });
    }

    updatePlaybackBar(totalChords) {
        const bar = document.getElementById('playback-bar');
        const rangeStart = document.getElementById('range-start');
        const rangeEnd = document.getElementById('range-end');

        if (bar) bar.max = totalChords > 0 ? totalChords - 1 : 0;
        if (rangeStart) rangeStart.max = totalChords;
        if (rangeEnd) {
            rangeEnd.max = totalChords;
            if (parseInt(rangeEnd.value) > totalChords) rangeEnd.value = totalChords;
            if (totalChords > 0 && parseInt(rangeEnd.value) === 0) rangeEnd.value = totalChords;
        }
    }

    setPlaybackPosition(index) {
        const bar = document.getElementById('playback-bar');
        if (bar) bar.value = index;

        const chordEls = document.querySelectorAll('.chord-item');
        chordEls.forEach(el => el.classList.remove('playing'));
        if (chordEls[index]) {
            chordEls[index].classList.add('playing');
            chordEls[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
        this.updateMarkerPositions();
    }
}

class Settings {
    constructor() {
        this.modal = document.getElementById('settings-modal');
        this.loadShortcuts();
        this.setupUI();
        this.recordingAction = null;
    }

    loadShortcuts() {
        // Default shortcuts
        this.shortcuts = {
            copy: { ctrl: true, key: 'c' },
            cut: { ctrl: true, key: 'x' },
            paste: { ctrl: true, key: 'v' },
            delete: { ctrl: false, key: 'Delete' },
            undo: { ctrl: true, shift: false, key: 'z' },
            redo: { ctrl: true, shift: true, key: 'z' },
            play: { ctrl: false, key: ' ' }
        };

        // Load from localStorage
        const saved = localStorage.getItem('pianoAppShortcuts');
        if (saved) {
            try {
                this.shortcuts = JSON.parse(saved);
            } catch (e) {
                console.error('Failed to load shortcuts:', e);
            }
        }

        this.updateShortcutDisplays();
    }

    saveShortcuts() {
        localStorage.setItem('pianoAppShortcuts', JSON.stringify(this.shortcuts));
        this.updateShortcutDisplays();
        window.app.ui.showNotification('Settings Saved');
    }

    setupUI() {
        // Settings button
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.showModal());
        }

        // Close button
        const closeBtn = document.getElementById('close-settings');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideModal());
        }

        // Click outside to close
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hideModal();
            }
        });

        // Change buttons
        document.querySelectorAll('.shortcut-row button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                this.startRecording(action);
            });
        });

        // Reset button
        const resetBtn = document.getElementById('reset-shortcuts');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetToDefaults());
        }

        // Save button
        const saveBtn = document.getElementById('save-settings');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveShortcuts();
                this.hideModal();
            });
        }

        // Setup inputs for recording
        Object.keys(this.shortcuts).forEach(action => {
            const input = document.getElementById(`setting-${action}`);
            if (input) {
                input.addEventListener('click', () => this.startRecording(action));
            }
        });

        // Update displays
        this.updateShortcutDisplays();
    }

    showModal() {
        this.modal.classList.add('show');
        this.updateInputValues();
    }

    hideModal() {
        this.modal.classList.remove('show');
        if (this.recordingAction) {
            const input = document.getElementById(`setting-${this.recordingAction}`);
            if (input) input.classList.remove('recording');
            this.recordingAction = null;
        }
    }

    startRecording(action) {
        // Stop any previous recording
        if (this.recordingAction) {
            const prevInput = document.getElementById(`setting-${this.recordingAction}`);
            if (prevInput) prevInput.classList.remove('recording');
        }

        this.recordingAction = action;
        const input = document.getElementById(`setting-${action}`);
        if (input) {
            input.classList.add('recording');
            input.value = 'Press keys...';
            input.focus();
        }

        // Add keydown listener
        const handler = (e) => {
            if (!this.recordingAction) return;

            e.preventDefault();
            e.stopPropagation();

            const shortcut = {
                ctrl: e.ctrlKey || e.metaKey,
                shift: e.shiftKey,
                alt: e.altKey,
                key: e.key
            };

            this.shortcuts[action] = shortcut;
            input.classList.remove('recording');
            this.updateInputValues();
            this.recordingAction = null;

            // Remove listener
            document.removeEventListener('keydown', handler, true);
        };

        document.addEventListener('keydown', handler, true);
    }

    updateInputValues() {
        Object.keys(this.shortcuts).forEach(action => {
            const input = document.getElementById(`setting-${action}`);
            if (input) {
                input.value = this.getShortcutString(this.shortcuts[action]);
            }
        });
    }

    getShortcutString(shortcut) {
        let parts = [];
        if (shortcut.ctrl) parts.push('Ctrl');
        if (shortcut.shift) parts.push('Shift');
        if (shortcut.alt) parts.push('Alt');

        let key = shortcut.key;
        if (key === ' ') key = 'Space';
        parts.push(key);

        return parts.join('+');
    }

    updateShortcutDisplays() {
        // Update context menu shortcuts
        const actions = ['copy', 'cut', 'paste', 'delete'];
        actions.forEach(action => {
            const el = document.getElementById(`shortcut-${action}`);
            if (el && this.shortcuts[action]) {
                el.textContent = this.getShortcutString(this.shortcuts[action]);
            }
        });
    }

    resetToDefaults() {
        this.shortcuts = {
            copy: { ctrl: true, key: 'c' },
            cut: { ctrl: true, key: 'x' },
            paste: { ctrl: true, key: 'v' },
            delete: { ctrl: false, key: 'Delete' },
            undo: { ctrl: true, shift: false, key: 'z' },
            redo: { ctrl: true, shift: true, key: 'z' },
            play: { ctrl: false, key: ' ' }
        };
        this.updateInputValues();
        this.saveShortcuts();
    }

    matchesShortcut(e, action) {
        const shortcut = this.shortcuts[action];
        if (!shortcut) return false;

        const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = shortcut.alt ? e.altKey : !e.altKey;
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase() || e.code === shortcut.key || e.key === shortcut.key;

        return ctrlMatch && shiftMatch && altMatch && keyMatch;
    }
}

class App {
    constructor() {
        this.audio = new AudioEngine();
        this.ui = new AppUI();
        this.midi = new MidiEngine(this.audio, this.ui);

        this.chords = [];
        this.isPlaying = false;
        this.bpm = 120;
        this.schedulerId = null;
        this.metronomeTimeouts = [];
        this.dragStartIndex = null;
        this.metronomeEnabled = false;
        this.currentChordIndex = 0;
        this.playRange = { start: 0, end: 0 };
        this.loopEnabled = false;

        // Selection & Clipboard
        this.selectedChordIndices = new Set();
        this.clipboard = [];

        // Undo/Redo Stacks
        this.undoStack = [];
        this.redoStack = [];

        // Settings
        this.settings = null;

        this.init();
    }

    init() {
        this.midi.init();
        this.ui.setupTimelineDrag();

        this.ui.setupSelectionDrag();

        // Initialize settings after DOM is ready
        setTimeout(() => {
            this.settings = new Settings();
        }, 0);

        // Event Listeners
        document.querySelectorAll('.chord-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const root = btn.dataset.root;
                this.addChord(root, 'major'); // Type is determined by UI in addChord
            });
        });

        document.getElementById('refresh-midi-btn').addEventListener('click', () => {
            this.midi.init();
            this.ui.showNotification("Refreshing MIDI devices...");
        });

        document.getElementById('play-btn').addEventListener('click', () => this.togglePlay());
        document.getElementById('stop-btn').addEventListener('click', () => this.stop());
        document.getElementById('clear-btn').addEventListener('click', () => this.clearChords());
        document.getElementById('bpm').addEventListener('change', (e) => this.bpm = parseInt(e.target.value));

        document.getElementById('metronome-toggle').addEventListener('change', (e) => {
            this.metronomeEnabled = e.target.checked;
        });

        document.getElementById('rest-btn').addEventListener('click', () => {
            this.addChord('Rest', 'rest');
        });



        // Volume Controls
        document.getElementById('piano-vol').addEventListener('input', (e) => {
            this.audio.setPianoVolume(e.target.value);
        });

        document.getElementById('metro-vol').addEventListener('input', (e) => {
            this.audio.setMetronomeVolume(e.target.value);
        });

        // Key Labels Toggle
        document.getElementById('key-labels-toggle').addEventListener('change', (e) => {
            this.ui.toggleKeyLabels(e.target.checked);
        });

        // Loop and Reset Controls
        document.getElementById('loop-toggle').addEventListener('change', (e) => {
            this.loopEnabled = e.target.checked;
        });

        document.getElementById('reset-btn').addEventListener('click', () => this.reset());

        // Playback Bar
        const playbackBar = document.getElementById('playback-bar');
        if (playbackBar) {
            playbackBar.addEventListener('input', (e) => {
                this.currentChordIndex = parseInt(e.target.value);
                this.ui.setPlaybackPosition(this.currentChordIndex);
                if (this.isPlaying) {
                    // Restart playback from new position
                    clearTimeout(this.schedulerId);
                    this.playNext();
                }
            });
        }

        // Range Inputs
        const rangeStart = document.getElementById('range-start');
        if (rangeStart) {
            rangeStart.addEventListener('change', (e) => {
                let val = parseInt(e.target.value) - 1;
                if (val < 0) val = 0;
                this.playRange.start = val;
                this.ui.updateMarkerPositions();
            });
        }

        const rangeEnd = document.getElementById('range-end');
        if (rangeEnd) {
            rangeEnd.addEventListener('change', (e) => {
                let val = parseInt(e.target.value) - 1;
                this.playRange.end = val;
                this.ui.updateMarkerPositions();
            });
        }

        // Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            // Skip if typing in input/textarea
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Wait for settings to be initialized
            if (!this.settings) return;

            // Play/Pause
            if (this.settings.matchesShortcut(e, 'play')) {
                e.preventDefault();
                this.togglePlay();
            }

            // Undo
            if (this.settings.matchesShortcut(e, 'undo')) {
                e.preventDefault();
                this.undo();
            }

            // Redo
            if (this.settings.matchesShortcut(e, 'redo')) {
                e.preventDefault();
                this.redo();
            }

            // Copy
            if (this.settings.matchesShortcut(e, 'copy')) {
                e.preventDefault();
                this.copySelection();
            }

            // Cut
            if (this.settings.matchesShortcut(e, 'cut')) {
                e.preventDefault();
                this.cutSelection();
            }

            // Paste
            if (this.settings.matchesShortcut(e, 'paste')) {
                e.preventDefault();
                this.pasteSelection();
            }

            // Delete
            if (this.settings.matchesShortcut(e, 'delete')) {
                e.preventDefault();
                this.deleteSelection();
            }
        });
    }

    saveState() {
        // Deep copy chords array
        const state = JSON.parse(JSON.stringify(this.chords));
        this.undoStack.push(state);
        // Limit stack size
        if (this.undoStack.length > 50) this.undoStack.shift();
        // Clear redo stack on new action
        this.redoStack = [];
    }

    undo() {
        if (this.undoStack.length === 0) return;

        // Save current state to redo stack
        this.redoStack.push(JSON.parse(JSON.stringify(this.chords)));

        const prevState = this.undoStack.pop();
        this.chords = prevState;
        this.ui.refreshTimeline(this.chords);

        // Update range if needed
        if (this.playRange.end >= this.chords.length) {
            this.playRange.end = Math.max(0, this.chords.length - 1);
            this.updateRangeInputs();
        }
        this.ui.showNotification("Undo");
    }

    redo() {
        if (this.redoStack.length === 0) return;

        // Save current state to undo stack
        this.undoStack.push(JSON.parse(JSON.stringify(this.chords)));

        const nextState = this.redoStack.pop();
        this.chords = nextState;
        this.ui.refreshTimeline(this.chords);

        // Update range if needed
        if (this.playRange.end >= this.chords.length) {
            this.playRange.end = Math.max(0, this.chords.length - 1);
            this.updateRangeInputs();
        }
        this.ui.showNotification("Redo");
    }

    updateRangeInputs() {
        const rangeStart = document.getElementById('range-start');
        const rangeEnd = document.getElementById('range-end');
        if (rangeStart) rangeStart.value = this.playRange.start + 1;
        if (rangeEnd) rangeEnd.value = this.playRange.end + 1;
    }

    playNote(note) {
        this.audio.playNote(note);
        this.ui.highlightKey(note, true, 'manual');
    }

    stopNote(note) {
        this.audio.stopNote(note);
        this.ui.highlightKey(note, false, 'manual');
    }

    addChord(root, type) {
        this.saveState();

        const qualitySelect = document.getElementById('chord-quality');
        const durationInput = document.querySelector('input[name="duration"]:checked');

        const quality = qualitySelect ? qualitySelect.value : 'major';
        const duration = durationInput ? parseInt(durationInput.value) : 4;

        let chordName;
        let chordType = quality;

        if (root === 'Rest') {
            chordName = 'Rest';
            chordType = 'rest';
        } else {
            let suffix = '';
            switch (quality) {
                case 'major': suffix = ''; break;
                case 'minor': suffix = 'm'; break;
                case '7': suffix = '7'; break;
                case 'maj7': suffix = 'maj7'; break;
                case 'm7': suffix = 'm7'; break;
            }
            chordName = `${root}${suffix}`;
        }

        const chord = {
            root,
            type: chordType,
            name: chordName,
            inversion: 0,
            duration: duration
        };

        // Insert at current playhead position
        this.chords.splice(this.currentChordIndex, 0, chord);
        this.currentChordIndex++;

        this.ui.refreshTimeline(this.chords);
        this.ui.showNotification("Chord Added");

        this.playRange.end = this.chords.length - 1;
        this.updateRangeInputs();
    }

    removeChord(index) {
        this.saveState();
        this.chords.splice(index, 1);
        this.ui.refreshTimeline(this.chords);
        if (this.playRange.end >= this.chords.length) {
            this.playRange.end = Math.max(0, this.chords.length - 1);
            this.updateRangeInputs();
        }
    }

    reorderChords(newIndices) {
        this.saveState();
        const newChords = newIndices.map(i => this.chords[i]);
        this.chords = newChords;
        this.ui.refreshTimeline(this.chords);
    }

    toggleInversion(index) {
        const chord = this.chords[index];
        if (chord.type === 'rest') return;

        this.saveState();
        this.ui.clearManualHighlights();

        chord.inversion = (chord.inversion + 1) % 3;
        this.ui.refreshTimeline(this.chords);
    }

    previewChord(index, show) {
        const chord = this.chords[index];
        if (!chord || chord.type === 'rest') return;

        const notes = this.getChordNotes(chord.root, chord.type, chord.inversion);
        notes.forEach(note => {
            this.ui.highlightKey(note, show, 'manual');
        });
    }

    clearChords() {
        this.saveState();
        this.chords = [];
        this.ui.clearTimeline();
        this.stop();
        this.currentChordIndex = 0;
        this.playRange = { start: 0, end: 0 };
        this.updateRangeInputs();
    }

    getChordNotes(root, type, inversion = 0) {
        if (type === 'rest') return [];

        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const rootIndex = notes.indexOf(root);
        const baseOctave = 4;

        let intervals = [];
        switch (type) {
            case 'major': intervals = [0, 4, 7]; break;
            case 'minor': intervals = [0, 3, 7]; break;
            case '7': intervals = [0, 4, 7, 10]; break;
            case 'maj7': intervals = [0, 4, 7, 11]; break;
            case 'm7': intervals = [0, 3, 7, 10]; break;
            default: intervals = [0, 4, 7];
        }

        let chordNotes = intervals.map(interval => {
            let noteIndex = rootIndex + interval;
            let octave = baseOctave;
            while (noteIndex >= 12) {
                noteIndex -= 12;
                octave++;
            }
            return (octave + 1) * 12 + noteIndex;
        });

        if (inversion > 0) {
            chordNotes[0] += 12;
            chordNotes.sort((a, b) => a - b);
            if (inversion === 2) {
                chordNotes[0] += 12;
                chordNotes.sort((a, b) => a - b);
            }
        }

        return chordNotes;
    }

    togglePlay() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
    }

    reset() {
        this.stop();
        this.currentChordIndex = this.playRange.start;
        this.ui.setPlaybackPosition(this.currentChordIndex);
    }

    playMetronomeTick() {
        if (!this.metronomeEnabled) return;
        const osc = this.audio.ctx.createOscillator();
        const gain = this.audio.ctx.createGain();
        osc.frequency.value = 1000;
        osc.type = 'square';
        gain.gain.value = 0.1;

        osc.connect(gain);
        gain.connect(this.audio.metronomeGain);

        osc.start();
        osc.stop(this.audio.ctx.currentTime + 0.05);
    }

    play() {
        if (this.chords.length === 0) return;
        this.isPlaying = true;
        document.getElementById('play-btn').textContent = 'Pause';

        if (this.currentChordIndex < this.playRange.start || this.currentChordIndex > this.playRange.end) {
            this.currentChordIndex = this.playRange.start;
        }

        this.playNext();
    }

    playNext() {
        if (!this.isPlaying) return;

        if (this.currentChordIndex > this.playRange.end || this.currentChordIndex >= this.chords.length) {
            if (this.loopEnabled) {
                this.currentChordIndex = this.playRange.start;
            } else {
                this.stop();
                return;
            }
        }

        this.ui.setPlaybackPosition(this.currentChordIndex);

        const chord = this.chords[this.currentChordIndex];
        const duration = chord.duration || 4;
        const secondsPerBeat = 60 / this.bpm;
        const secondsPerChord = secondsPerBeat * duration;

        if (this.metronomeEnabled) {
            this.metronomeTimeouts = [];
            for (let i = 0; i < duration; i++) {
                const id = setTimeout(() => this.playMetronomeTick(), i * secondsPerBeat * 1000);
                this.metronomeTimeouts.push(id);
            }
        }

        if (chord.type !== 'rest') {
            const notes = this.getChordNotes(chord.root, chord.type, chord.inversion);
            notes.forEach(note => {
                this.audio.playNote(note, 100);
                this.ui.highlightKey(note, true, 'auto');
                setTimeout(() => {
                    this.audio.stopNote(note);
                    this.ui.highlightKey(note, false, 'auto');
                }, secondsPerChord * 1000 - 100);
            });
        }

        this.currentChordIndex++;
        this.schedulerId = setTimeout(() => this.playNext(), secondsPerChord * 1000);
    }



    stop() {
        this.isPlaying = false;
        const playBtn = document.getElementById('play-btn');
        if (playBtn) playBtn.textContent = 'Play';
        clearTimeout(this.schedulerId);

        this.metronomeTimeouts.forEach(id => clearTimeout(id));
        this.metronomeTimeouts = [];

        document.querySelectorAll('.chord-item').forEach(el => el.classList.remove('playing'));

        for (let i = 0; i < 127; i++) {
            this.audio.stopNote(i);
            this.ui.highlightKey(i, false, 'auto');
            this.ui.highlightKey(i, false, 'manual');
        }
    }

    // Selection Logic
    selectChord(index, multi = false) {
        if (!multi) {
            this.selectedChordIndices.clear();
        }
        this.selectedChordIndices.add(index);
        this.ui.updateSelectionVisuals();
    }

    deselectAll() {
        this.selectedChordIndices.clear();
        this.ui.updateSelectionVisuals();
    }

    toggleSelection(index) {
        if (this.selectedChordIndices.has(index)) {
            this.selectedChordIndices.delete(index);
        } else {
            this.selectedChordIndices.add(index);
        }
        this.ui.updateSelectionVisuals();
    }

    selectRange(start, end) {
        this.selectedChordIndices.clear();
        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            this.selectedChordIndices.add(i);
        }
        this.ui.updateSelectionVisuals();
    }

    // Context Menu Actions
    updateSelectedChords(action, value) {
        if (this.selectedChordIndices.size === 0) return;
        this.saveState();

        this.selectedChordIndices.forEach(index => {
            const chord = this.chords[index];
            if (chord.root === 'Rest') return;

            if (action === 'type') {
                chord.type = value;
                let name = chord.root;
                if (value === 'minor') name += 'm';
                else if (value === '7') name += '7';
                else if (value === 'maj7') name += 'maj7';
                else if (value === 'm7') name += 'm7';
                chord.name = name;
            } else if (action === 'duration') {
                chord.duration = parseInt(value);
            } else if (action === 'inversion') {
                chord.inversion = parseInt(value);
            }
        });

        this.ui.refreshTimeline(this.chords);
        this.ui.showNotification("Chords Updated");
    }

    copySelection() {
        if (this.selectedChordIndices.size === 0) return;
        const indices = Array.from(this.selectedChordIndices).sort((a, b) => a - b);
        this.clipboard = indices.map(i => JSON.parse(JSON.stringify(this.chords[i])));
        this.ui.showNotification("Copied " + this.clipboard.length + " chords");
    }

    cutSelection() {
        if (this.selectedChordIndices.size === 0) return;
        this.copySelection();
        this.deleteSelection();
    }

    pasteSelection() {
        if (this.clipboard.length === 0) return;
        this.saveState();

        this.chords.splice(this.currentChordIndex, 0, ...JSON.parse(JSON.stringify(this.clipboard)));

        this.selectedChordIndices.clear();
        for (let i = 0; i < this.clipboard.length; i++) {
            this.selectedChordIndices.add(this.currentChordIndex + i);
        }

        this.currentChordIndex += this.clipboard.length;
        this.ui.refreshTimeline(this.chords);
        this.ui.showNotification("Pasted " + this.clipboard.length + " chords");
    }

    deleteSelection() {
        if (this.selectedChordIndices.size === 0) return;
        this.saveState();

        const indices = Array.from(this.selectedChordIndices).sort((a, b) => b - a);
        indices.forEach(i => {
            this.chords.splice(i, 1);
        });

        this.selectedChordIndices.clear();
        this.ui.refreshTimeline(this.chords);
        this.ui.showNotification("Deleted Chords");
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.app = new App();
        console.log("Piano App Initialized");
    } catch (error) {
        console.error("Failed to initialize app:", error);
        alert("App initialization failed: " + error.message);
    }
});
