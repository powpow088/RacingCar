// ==========================================
// Web Audio API Synthesizer (無外部檔案音效引擎)
// ==========================================

const AudioSys = {
    ctx: null,
    masterGain: null,
    isMuted: false,
    initialized: false,

    init() {
        if (this.initialized) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.5; // 預設音量
        this.masterGain.connect(this.ctx.destination);

        // BGM / Engine state
        this.bgmOsc = null;
        this.engineOsc = null;
        this.engineFilter = null;

        this.initialized = true;
    },

    toggleMute() {
        if (!this.initialized) this.init();
        this.isMuted = !this.isMuted;
        this.masterGain.gain.value = this.isMuted ? 0 : 0.5;
        return this.isMuted;
    },

    // 播放爆炸聲 (White Noise + Envelope)
    playExplosion() {
        if (!this.initialized || this.isMuted) return;
        const ctx = this.ctx;

        const bufferSize = ctx.sampleRate * 1.5; // 1.5 秒
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            // 產生隨機雜訊，並用低頻濾除高亢刺耳聲
            data[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - i / bufferSize);
        }

        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = buffer;

        // 加個低通濾波器讓爆炸聲悶一點、厚實一點
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 1);

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(1, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);

        noiseSource.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        noiseSource.start();
    },

    // 發射飛彈聲 (Sweep down)
    playMissileLaunch() {
        if (!this.initialized || this.isMuted) return;
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.3); // 快速降頻

        gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

        osc.connect(gainNode);
        gainNode.connect(this.masterGain);

        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    },

    // 吃到道具聲 (Arpeggio)
    playPowerUp() {
        if (!this.initialized || this.isMuted) return;
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = 'sine';

        // 快速的三連音琶音
        osc.frequency.setValueAtTime(440, ctx.currentTime);      // A4
        osc.frequency.setValueAtTime(554.37, ctx.currentTime + 0.1); // C#5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.2); // E5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3);    // A5

        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
        gainNode.gain.setValueAtTime(0.5, ctx.currentTime + 0.3);
        gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);

        osc.connect(gainNode);
        gainNode.connect(this.masterGain);

        osc.start();
        osc.stop(ctx.currentTime + 0.5);
    },

    // 撞車聲 (短促噪音)
    playCrash() {
        if (!this.initialized || this.isMuted) return;
        const ctx = this.ctx;
        const bufferSize = ctx.sampleRate * 0.3; // 0.3 秒
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 800;
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(1, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        noiseSource.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);
        noiseSource.start();
    },

    // 引擎連續音效
    startEngine() {
        if (!this.initialized || this.engineOsc) return;
        const ctx = this.ctx;
        this.engineOsc = ctx.createOscillator();
        this.engineOsc.type = 'square';
        this.engineOsc.frequency.value = 50; // 低頻嗡嗡聲

        this.engineFilter = ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 100; // 悶住的高頻

        const engineGain = ctx.createGain();
        engineGain.gain.value = 0.1; // 引擎聲維持較小音量

        this.engineOsc.connect(this.engineFilter);
        this.engineFilter.connect(engineGain);
        engineGain.connect(this.masterGain);
        this.engineOsc.start();
    },

    // 根據當前速度設定引擎頻率
    updateEngineSpeed(speedRatio) {
        if (!this.engineOsc || !this.engineFilter) return;
        // speedRatio 介於 0~1 甚至更高(Boost)
        const baseFreq = 50;
        const targetFreq = baseFreq + (speedRatio * 100);
        this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);
        this.engineFilter.frequency.setTargetAtTime(100 + speedRatio * 400, this.ctx.currentTime, 0.1);
    },

    stopEngine() {
        if (this.engineOsc) {
            this.engineOsc.stop();
            this.engineOsc.disconnect();
            this.engineOsc = null;
        }
    },

    // 簡單合成器 BGM Loop (Bassline)
    startBGM() {
        if (!this.initialized || this.bgmOsc) return;
        const ctx = this.ctx;

        // 為了持續迴圈，我們用一個 setInterval 排程簡單的拍子
        let noteIdx = 0;
        // 小調五聲音階 (A, C, D, E, G)
        const notes = [110, 110, 130.81, 146.83, 110, 164.81, 146.83, 130.81];

        this.bgmTimer = setInterval(() => {
            if (this.isMuted || !GameState.isRunning) return;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.value = notes[noteIdx % notes.length];
            // 八度交替
            if (noteIdx % 4 === 0) osc.frequency.value /= 2;

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(300, ctx.currentTime);
            filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);

            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);

            osc.start();
            osc.stop(ctx.currentTime + 0.2);

            noteIdx++;
        }, 150); // 16分音符 @ 100 BPM
    },

    stopBGM() {
        if (this.bgmTimer) {
            clearInterval(this.bgmTimer);
            this.bgmTimer = null;
        }
    }
};

window.AudioSys = AudioSys;
