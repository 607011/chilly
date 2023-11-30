/*
    Copyright ©️ 2023 Oliver Lau, Heise Medien GmbH & Co. KG, Redaktion c't

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
*/

import('./static/js/bezier.min.js');
import('./static/js/howler.core.min.js');

window.exports = null;

(function (window) {
    "use strict";

    const DEBUG = true;

    class Tile {
        static Size = 32;
        static Empty = ' ';
        static Ice = ' ';
        static Marker = '.';
        static Rock = '#';
        static Flower = 'Y';
        static Tree = 'T';
        static Exit = 'X';
        static Player = 'P';
        static Coin = '$';
        static Gold = 'G';
        static Hole = 'O';
    };

    class Tiles {
        static PenguinUpright = 'penguin-standing-xmas';
        static PenguinLeft = 'penguin-left-xmas';
        static PenguinRight = 'penguin-right-xmas';
        static PenguinUp = 'penguin-up-xmas';
        static PenguinDown = 'penguin-down-xmas';
    }

    class State {
        static PreInit = -1;
        static SplashScreen = 0;
        static Playing = 1;
        static LevelEnd = 2;
        static GameEnd = 3;
        static SettingsScreen = 4;
        static ProgressScreen = 5;
        static Autoplay = 6;
    }

    class StorageKey {
        static LevelNum = 'chilly.level';
        static MaxLevelNum = 'chilly.max-level';
    }

    const POINTS = {
        $: 5,
        G: 20,
    };

    let LEVELS = [];
    const START_LEVEL = 0;
    const DeceleratingEasing = bezier(.34, .87, 1, 1);
    const el = {};
    let player = {
        x: 0,
        y: 0,
        world: { x: 0, y: 0 },
        dest: { x: 0, y: 0 },
        el: null,
        moves: [],
        distance: 0,
    };
    let autoplayIdx = 0;
    let autoplayMoves = '';
    let level = {
        origData: [],
        connections: [],
        data: [],
        width: 0,
        height: 0,
        cellAt: function (x, y) {
            return level.data[(y + level.height) % level.height][(x + level.width) % level.width];
        },
        currentIdx: 0,
        collectibles: {},
    };
    let world = { width: 0, height: 0 };
    let viewPort = { x: 0, y: 0, width: 0, height: 0 };
    let state = State.PreInit;
    let prevState;
    let t0, t1, animationDuration;
    let tiles = [[]];
    let holes = [];
    let isMoving = false;
    let exitReached = false;
    let holeEntered = false;
    let easing = DeceleratingEasing;
    let sounds = {};

    function squared(x) {
        return x * x;
    }

    function linear(x) {
        return x;
    }

    function onBeforeUnload(e) {
        e.preventDefault();
        return false;
    }

    function placePlayerOnPixel(x, y) {
        player.world.x = Tile.Size * x;
        player.world.y = Tile.Size * y + 1;
        player.el.style.left = `${player.world.x}px`;
        player.el.style.top = `${player.world.y}px`;
        scrollIntoView();
    }

    function placePlayerOnTile(x, y) {
        player.x = (x + level.width) % level.width;
        player.y = (y + level.height) % level.height;
        placePlayerOnPixel(player.x, player.y);
    }

    function onResize(e) {
        const GameElPadding = 5;
        viewPort = el.game.getBoundingClientRect();
        // console.debug(viewPort, el.game.scrollWidth, el.game.clientWidth);
        viewPort.width -= 2 * GameElPadding;
        viewPort.height -= 2 * GameElPadding;
        el.extraStyles.textContent = `:root {
            --game-width: ${viewPort.width}px;
        }`;
        scrollIntoView();
    }

    function scrollIntoView() {
        el.game.scrollTo({
            left: player.world.x - viewPort.width / 2,
            top: player.world.y - viewPort.width / 2,
            behavior: 'auto',
        });
    }

    function standUpright() {
        player.el.classList.remove(Tiles.PenguinLeft, Tiles.PenguinRight, Tiles.PenguinUp, Tiles.PenguinDown);
    }

    function teleport() {
        sounds.teleport.play();
        const connection = level.connections.find(conn => conn.src.x === player.x && conn.src.y === player.y);
        player.dest = { ...connection.dst };
        const angle = Math.atan2(player.dest.y - player.y, player.dest.x - player.x);
        player.el.classList.replace(Tiles.PenguinUpright, 'penguin-submerged')
        player.el.classList.add('submerged');
        player.el.style.transform = `rotate(${angle + Math.PI / 2}rad)`;
        standUpright();
        const dist = Math.sqrt(squared(player.x - player.dest.x) + squared(player.y - player.dest.y));
        animationDuration = 100 * dist;
        t0 = performance.now();
        t1 = t0 + animationDuration;
        isMoving = true;
        easing = linear;
        animateDive();
    }

    function animateDive() {
        const dt = performance.now() - t0;
        const f = easing(dt / animationDuration);
        const dx = f * (player.dest.x - player.x);
        const dy = f * (player.dest.y - player.y);
        player.world.x = Tile.Size * (player.x + dx);
        player.world.y = Tile.Size * (player.y + dy);
        player.el.style.left = `${player.world.x}px`;
        player.el.style.top = `${player.world.y}px`;
        scrollIntoView();
        if (performance.now() > t1) {
            placePlayerOnTile(player.dest.x, player.dest.y);
            player.el.classList.replace('penguin-submerged', Tiles.PenguinUpright)
            player.el.classList.remove('submerged');
            player.el.style.transform = 'rotate(0rad)';
            isMoving = false;
            checkAutoplay();
        }
        else {
            requestAnimationFrame(animateDive);
        }
    }

    function rockHit() {
        sounds.rock.play();
        standUpright();
        checkAutoplay();
    }

    function checkAutoplay() {
        if (state === State.Autoplay) {
            if (autoplayIdx < autoplayMoves.length) {
                moveTo(autoplayMoves[++autoplayIdx]);
            }
            else {
                restoreState();
            }
        }
    }

    function updateMoveCounter() {
        const path = player.moves.join('')
        el.path.textContent = path;
    }

    function animateRegularMove() {
        const dt = performance.now() - t0;
        const f = easing(dt / animationDuration);
        const dx = f * (player.dest.x - player.x);
        const dy = f * (player.dest.y - player.y);
        const x = (player.x + Math.round(dx) + level.width) % level.width;
        const y = (player.y + Math.round(dy) + level.height) % level.height;
        if (level.data[y][x] === Tile.Coin) {
            tiles[y][x].classList.replace('present', 'ice');
            delete level.collectibles[`${x},${y}`];
            level.data[y] = level.data[y].substring(0, x) + Tile.Ice + level.data[y].substring(x + 1);
            sounds.coin.play();
        }
        player.world.x = Tile.Size * ((player.x + dx + level.width) % level.width);
        player.world.y = Tile.Size * ((player.y + dy + level.height) % level.height);
        if (player.world.x < 0 || player.world.y < 0 || player.world.x > world.width - Tile.Size || player.world.y > world.height - Tile.Size) {
            player.el.classList.add('hidden');
        }
        else {
            player.el.classList.remove('hidden');
        }
        player.el.style.left = `${player.world.x}px`;
        player.el.style.top = `${player.world.y}px`;
        scrollIntoView();
        if (performance.now() > t1) {
            placePlayerOnTile(player.dest.x, player.dest.y);
            updateMoveCounter();
            isMoving = false;
            if (exitReached) {
                onExitReached();
            }
            else if (holeEntered) {
                teleport();
            }
            else {
                rockHit();
            }
        }
        else {
            requestAnimationFrame(animateRegularMove);
        }
    }

    function move(dx, dy) {
        if (isMoving || exitReached)
            return;
        let hasMoved = false;
        let { x, y } = player;
        let xStep = 0;
        let yStep = 0;
        while ([Tile.Ice, Tile.Coin, Tile.Gold, Tile.Marker, Tile.Empty].includes(level.cellAt(x + dx, y + dy))) {
            x += dx;
            y += dy;
            xStep += dx;
            yStep += dy;
        }
        exitReached = level.cellAt(x + dx, y + dy) === Tile.Exit;
        holeEntered = level.cellAt(x + dx, y + dy) === Tile.Hole;
        let dist = Math.abs(xStep) + Math.abs(yStep);
        if (xStep > 0) {
            player.el.classList.add(Tiles.PenguinRight);
            hasMoved = true;
        }
        else if (xStep < 0) {
            player.el.classList.add(Tiles.PenguinLeft);
            hasMoved = true;
        }
        else if (yStep < 0) {
            player.el.classList.add(Tiles.PenguinUp);
            hasMoved = true;
        }
        else if (yStep > 0) {
            player.el.classList.add(Tiles.PenguinDown);
            hasMoved = true;
        }
        else if (exitReached || holeEntered) {
            hasMoved = true;
            dist += 1;
        }
        if (dist > 0) {
            player.distance += dist;
            isMoving = true;
            if (exitReached || holeEntered) {
                player.dest = { x: x + dx, y: y + dy };
            }
            else {
                player.dest = { x, y };
            }
            easing = DeceleratingEasing;
            animationDuration = 100 * dist;
            t0 = performance.now();
            t1 = t0 + animationDuration;
            animateRegularMove();
        }
        return hasMoved;
    }

    function moveUp() {
        return move(0, -1);
    }

    function moveDown() {
        return move(0, +1);
    }

    function moveLeft() {
        return move(-1, 0);
    }

    function moveRight() {
        return move(+1, 0);
    }

    function moveTo(direction) {
        direction = direction.toUpperCase();
        player.moves.push(direction);
        switch (direction) {
            case 'U':
                moveUp();
                break;
            case 'D':
                moveDown();
                break;
            case 'L':
                moveLeft();
                break;
            case 'R':
                moveRight();
                break;
        }
    }

    function onKeyPressed(e) {
        if (!DEBUG && !isMoving && (e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            e.stopPropagation();
            resetLevel();
            return false;
        }
        switch (state) {
            case State.GameEnd:
                if (e.type === 'keypress') {
                    if (e.key === 'r') {
                        replayLevel();
                    }
                    e.preventDefault();
                }
                break;
            case State.LevelEnd:
                if (e.type === 'keypress') {
                    if (e.key === ' ') {
                        gotoNextLevel();
                    }
                    else if (e.key === 'r') {
                        replayLevel();
                    }
                    e.preventDefault();
                }
                break;
            case State.SettingsScreen:
                if (e.type === 'keydown' && e.key === 'Escape') {
                    removeOverlay();
                    restoreState();
                    e.preventDefault();
                    return;
                }
                break;
            case State.SplashScreen:
                if (e.type === 'keypress' && e.key === ' ') {
                    e.preventDefault();
                    play();
                }
                break;
            case State.Playing:
                if (isMoving)
                    return;
                let move;
                let hasMoved = false;
                switch (e.key) {
                    case 'w':
                    // fall-through
                    case 'ArrowUp':
                        hasMoved = moveUp();
                        move = 'U';
                        break;
                    case 'a':
                    // fall-through
                    case 'ArrowLeft':
                        hasMoved = moveLeft();
                        move = 'L';
                        break;
                    case 's':
                    // fall-through
                    case 'ArrowDown':
                        hasMoved = moveDown();
                        move = 'D';
                        break;
                    case 'd':
                    // fall-through
                    case 'ArrowRight':
                        hasMoved = moveRight();
                        move = 'R';
                        break;
                    case 'Escape':
                        if (e.type === 'keydown') {
                            showSettingsScreen();
                            e.preventDefault();
                            return;
                        }
                        break;
                }
                if (hasMoved) {
                    player.moves.push(move);
                }
                break;
            default:
                if (e.type === 'keydown' && e.key === 'Escape') {
                    if (state != State.SplashScreen) {
                        showSettingsScreen();
                    }
                    e.preventDefault();
                    return;
                }
                break;
        }
    }

    function onClick(e) {
        const dx = (e.target.offsetLeft / Tile.Size) - player.x;
        const dy = (e.target.offsetTop / Tile.Size) - player.y;
        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 0) {
                window.dispatchEvent(new KeyboardEvent('keypress', { 'key': 'd' }));
            }
            else {
                window.dispatchEvent(new KeyboardEvent('keypress', { 'key': 'a' }));
            }
        }
        else {
            if (dy > 0) {
                window.dispatchEvent(new KeyboardEvent('keypress', { 'key': 's' }));
            }
            else {
                window.dispatchEvent(new KeyboardEvent('keypress', { 'key': 'w' }));
            }
        }
        checkAudio();
    }

    function autoplay() {
        if (autoplayMoves.length === 0)
            return;
        player.moves = [];
        removeOverlay();
        restartGame();
        autoplayIdx = 0;
        setState(State.Autoplay);
        moveTo(autoplayMoves[0]);
    }

    window.exports = {
        autoplay: function (moves) {
            autoplayMoves = moves;
            autoplay();
        },
    };

    function generateScene() {
        const scene = document.createElement('div');
        scene.style.gridTemplateColumns = `repeat(${level.width}, ${Tile.Size}px)`;
        scene.style.gridTemplateRows = `repeat(${level.height}, ${Tile.Size}px)`;
        holes = [];
        tiles = [];
        level.collectibles = {};
        for (let y = 0; y < level.data.length; ++y) {
            const row = level.data[y];
            tiles.push([]);
            for (let x = 0; x < row.length; ++x) {
                const item = row[x];
                const tile = document.createElement('span');
                tile.className = 'tile';
                switch (item) {
                    case Tile.Rock:
                        tile.classList.add('rock');
                        break;
                    case Tile.Empty:
                        tile.classList.add('empty');
                        break;
                    case Tile.Coin:
                        tile.classList.add('present');
                        level.collectibles[`${x},${y}`] = item;
                        break;
                    case Tile.Gold:
                        tile.classList.add('gold');
                        level.collectibles[`${x},${y}`] = item;
                        break;
                    case Tile.Flower:
                        tile.classList.add('flower');
                        break;
                    case Tile.Tree:
                        tile.classList.add('snowy-tree');
                        break;
                    case Tile.Exit:
                        tile.classList.add('exit');
                        break;
                    case Tile.Hole:
                        tile.classList.add('hole');
                        holes.push({ x, y });
                        break;
                    case Tile.Player:
                        placePlayerOnTile(x, y);
                    // fall-through
                    case Tile.Ice:
                    default:
                        tile.classList.add('ice');
                        break;
                }
                scene.appendChild(tile);
                tiles[y].push(tile);
            }
        }
        return scene;
    }

    function replacePlayerWithIceTile() {
        level.data[player.y] = level.data[player.y].substring(0, player.x) + Tile.Ice + level.data[player.y].substring(player.x + 1);
    }

    function getNumStars() {
        const numStars = 3 - LEVELS[level.currentIdx].thresholds.findIndex(threshold => player.moves.length <= threshold);
        if (numStars === 4) {
            return 0;
        }
        return numStars;
    }

    function onExitReached() {
        sounds.exit.play();
        standUpright();
        setState(State.LevelEnd);
        const itemsLeft = Object.keys(level.collectibles).length > 0;
        const congrats = el.congratsTemplate.content.cloneNode(true);
        // congrats.querySelector('div.pulsating > span').textContent = level.currentIdx + 1 + 1;
        const stars = congrats.querySelectorAll('.star-pale');
        if (itemsLeft) {
            congrats.querySelector('div>div>div').innerHTML = 'Du hast Chilly zum Ausgang gelotst, aber du hast Geschenke liegen lassen. Der nächste Versuch gelingt bestimmt&nbsp;...';
        }
        else {
            const numStars = getNumStars();
            for (let i = 0; i < numStars; ++i) {
                stars[i].classList.replace('star-pale', 'star');
                stars[i].classList.add('pulse')
                if (i > 0) {
                    stars[i].classList.add(`pulse${i}`);
                }
            }
            congrats.querySelector('div>div>div').innerHTML = (function (numStars) {
                switch (numStars) {
                    case 0:
                        return 'Danke für die Hilfe! Aber da geht noch so Einiges ;-)';
                    case 1:
                        return 'Gar nicht übel, aber es gibt noch Raum für Verbesserungen.';
                    case 2:
                        return 'Gute Arbeit! Du liegst ziemlich weit vorn mit dem Ergebnis.';
                    case 3:
                        return 'Wow! Du bist ein herausragender Pinguin-Lotse! Diese Zugfolge solltest du einsenden.';
                    default:
                        return;
                }
            })(numStars);
        }
        el.proceed = congrats.querySelector('[data-command="proceed"]');
        if (level.currentIdx + 1 < LEVELS.length) {
            congrats.querySelector('[data-command="restart"]').remove();
            el.proceed.addEventListener('click', gotoNextLevel, { capture: true, once: true });
        }
        else {
            el.proceed.remove();
            setState(State.GameEnd);
        }
        el.replay = congrats.querySelector('[data-command="replay"]');
        el.replay.addEventListener('click', replayLevel, { capture: true, once: true });
        el.overlayBox.replaceChildren(congrats);
        t0 = performance.now();
        showOverlay();
    }

    function hasCollectibles(level) {
        return level.some(row => row.match('[\$G]'));
    }

    /**
     * @return  true, if level has collectibles, false otherwise
     */
    function levelHasCollectibles() {
        return hasCollectibles(level.origData);
    }

    function setLevel(levelData) {
        level.data = [...levelData.data];
        level.connections = levelData.connections;
        level.origData = [...levelData.data];
        level.width = level.data[0].length;
        level.height = level.data.length;
        world.width = Tile.Size * level.width;
        world.height = Tile.Size * level.height;
        if (level.connections instanceof Array) {
            for (const conn of level.connections) {
                console.assert(level.cellAt(conn.src.x, conn.src.y) === Tile.Hole);
                console.assert(level.cellAt(conn.dst.x, conn.dst.y) === Tile.Hole);
            }
        }
        player.moves = [];
        player.distance = 0;
        updateMoveCounter();
        el.scene = generateScene();
        el.game.replaceChildren(el.scene, player.el);
        replacePlayerWithIceTile();
        scrollIntoView();
    }

    function restoreState() {
        state = prevState;
    }

    function setState(newState) {
        prevState = state;
        state = newState;
    }

    function showOverlay() {
        el.overlay.classList.remove('hidden');
        el.overlayBox.classList.remove('hidden');
    }

    function removeOverlay() {
        el.overlay.classList.add('hidden');
        el.overlayBox.classList.add('hidden');
        el.overlayBox.replaceChildren();
    }

    function play() {
        el.overlayBox.removeEventListener('click', play);
        setState(State.Playing);
        removeOverlay();
        checkAudio();
    }

    function replayLevel() {
        el.replay.addEventListener('click', replayLevel, { capture: true, once: true });
        resetLevel();
        play();
    }

    function maxLevelNum() {
        let maxLvl = parseInt(localStorage.getItem(StorageKey.MaxLevelNum));
        if (isNaN(maxLvl)) {
            maxLvl = 0;
        }
        maxLvl = Math.max(level.currentIdx, Math.min(LEVELS.length, maxLvl));
        return maxLvl;
    }

    function gotoLevel(idx) {
        level.currentIdx = idx;
        localStorage.setItem(StorageKey.LevelNum, level.currentIdx);
        resetLevel();
        play();
    }

    function gotoNextLevel() {
        el.proceed.removeEventListener('click', gotoNextLevel);
        ++level.currentIdx;
        localStorage.setItem(StorageKey.LevelNum, level.currentIdx);
        localStorage.setItem(StorageKey.MaxLevelNum, maxLevelNum() + 1);
        resetLevel();
        play();
    }

    function showSplashScreen() {
        setState(State.SplashScreen);
        const splash = el.splashTemplate.content.cloneNode(true);
        el.overlayBox.replaceChildren(splash);
        el.overlayBox.addEventListener('click', play, { capture: true, once: true });
        showOverlay();
    }

    function showSettingsScreen() {
        setState(State.SettingsScreen);
        const settings = el.settingsTemplate.content.cloneNode(true);
        const lvlList = settings.querySelector('.level-list');
        const padding = 1 + Math.floor(Math.log10(LEVELS.length));
        const highestAccessibleLevelNum = maxLevelNum();
        let i = 0;
        for (const level of LEVELS) {
            const lvlName = level.name || '<?>';
            const div = document.createElement('div');
            div.textContent = `Level ${(i + 1).toString().padStart(padding, ' ')}: ${lvlName}`;
            div.setAttribute('data-level-idx', i);
            if (i < highestAccessibleLevelNum) {
                div.addEventListener('click', e => {
                    removeOverlay();
                    gotoLevel(e.target.getAttribute('data-level-idx') | 0);
                });
            }
            else {
                div.classList.add('locked');
            }
            lvlList.appendChild(div);
            ++i;
        }
        el.overlayBox.replaceChildren(settings);
        showOverlay();
    }

    function resetLevel() {
        exitReached = false;
        let levelData = LEVELS[level.currentIdx];
        el.path.textContent = '';
        if (window.location.hash) {
            const hash = window.location.hash.substring(1);
            const params = hash.split(';');
            for (const param of params) {
                const [key, value] = param.split('=');
                if (key === 'level' && value.length > 0) {
                    levelData = JSON.parse(atob(value));
                }
            }
        }
        setLevel(levelData);
    }

    function restartGame() {
        let levelNum = Math.min(LEVELS.length - 1, parseInt(localStorage.getItem(StorageKey.LevelNum)));
        if (isNaN(levelNum)) {
            levelNum = START_LEVEL;
        }
        if (levelNum < 0) {
            levelNum = 0;
        }
        level.currentIdx = levelNum;
        resetLevel();
    }

    function checkAudio(e) {
        if (typeof e === 'object' && e.type === 'click') {
            Howler.mute(!Howler._muted);
        }
        if (Howler._muted) {
            el.loudspeaker.classList.replace('speaker', 'speaker-muted');
        }
        else {
            el.loudspeaker.classList.replace('speaker-muted', 'speaker');
        }
    }

    function setupAudio() {
        sounds.coin = new Howl({
            src: ['static/sounds/coin.mp3', 'static/sounds/coin.webm', 'static/sounds/coin.ogg'],
        });
        sounds.rock = new Howl({
            src: ['static/sounds/rock.mp3', 'static/sounds/rock.webm', 'static/sounds/rock.ogg'],
        });
        sounds.exit = new Howl({
            src: ['static/sounds/exit.mp3', 'static/sounds/exit.webm', 'static/sounds/exit.ogg'],
        });
        sounds.teleport = new Howl({
            src: ['static/sounds/teleport.mp3', 'static/sounds/teleport.webm', 'static/sounds/teleport.ogg'],
        });
        sounds.slide = new Howl({
            src: ['static/sounds/slide.mp3', 'static/sounds/slide.webm', 'static/sounds/slide.ogg'],
            volume: .5,
        });
        Howler.mute(false);
        checkAudio();
    }

    function main() {
        LEVELS = JSON.parse(document.querySelector('#levels').textContent);
        el.game = document.querySelector('#game');
        el.game.addEventListener('click', onClick);
        el.extraStyles = document.querySelector('#extra-styles');
        el.moveCount = document.querySelector('#move-count');
        el.extras = document.querySelector('#extras');
        el.path = document.querySelector('#path');
        el.overlay = document.querySelector('#overlay');
        el.overlayBox = document.querySelector('#overlay-box');
        el.loudspeaker = document.querySelector('#loudspeaker');
        el.loudspeaker.addEventListener('click', checkAudio);
        document.querySelector('#restart-level').addEventListener('click', resetLevel);
        el.splashTemplate = document.querySelector("#splash");
        el.congratsTemplate = document.querySelector("#congrats");
        el.settingsTemplate = document.querySelector("#settings");
        player.el = document.createElement('span');
        player.el.className = `tile penguin ${Tiles.PenguinUpright}`;
        setupAudio();
        if (!DEBUG)
            window.addEventListener("beforeunload", onBeforeUnload, { capture: true });
        window.addEventListener('keydown', onKeyPressed);
        window.addEventListener('keypress', onKeyPressed);
        window.addEventListener('resize', onResize);
        document.querySelector('.interactive.arrow-up').addEventListener('click', () => {
            window.dispatchEvent(new KeyboardEvent('keypress', { 'key': 'w' }));
        });
        document.querySelector('.interactive.arrow-down').addEventListener('click', () => {
            window.dispatchEvent(new KeyboardEvent('keypress', { 'key': 's' }));
        });
        document.querySelector('.interactive.arrow-right').addEventListener('click', () => {
            window.dispatchEvent(new KeyboardEvent('keypress', { 'key': 'd' }));
        });
        document.querySelector('.interactive.arrow-left').addEventListener('click', () => {
            window.dispatchEvent(new KeyboardEvent('keypress', { 'key': 'a' }));
        });
        restartGame();
        showSplashScreen();
        document.querySelector('#controls').classList.remove('hidden');
        window.dispatchEvent(new Event('resize'));
    }
    window.addEventListener('load', main);
})(window);
