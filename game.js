// ==========================================
// 遊戲核心邏輯 (Game Logic)
// ==========================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- UI Elements ---
const screens = {
    menu: document.getElementById('main-menu'),
    game: document.getElementById('game-screen'),
    gameOver: document.getElementById('game-over-screen')
};

const hud = {
    hp: document.getElementById('hud-hp'),
    time: document.getElementById('hud-time'),
    dist: document.getElementById('hud-dist'),
    speed: document.getElementById('hud-speed'),
    ammo: document.getElementById('hud-ammo'),
    coins: document.getElementById('hud-coins')
};

const effectNotice = document.getElementById('effect-notice');

// --- Game Configurations ---
const CAR_PRESETS = {
    balanced: { hp: 10, maxSpeed: 6, accel: 0.06, turnSpeed: 5, color: '#3498db', driftInertia: 0.1 },
    heavy: { hp: 15, maxSpeed: 4, accel: 0.025, turnSpeed: 3, color: '#e67e22', driftInertia: 0.05 },
    sports: { hp: 5, maxSpeed: 9, accel: 0.12, turnSpeed: 7, color: '#e74c3c', driftInertia: 0.2 },
    ultraman: { hp: 10, maxSpeed: 12, accel: 0.25, turnSpeed: 8, color: '#ecf0f1', driftInertia: 0.15 }
};

const DIFF_PRESETS = {
    easy: { startTime: 240, trafficRate: 0.004, trafficSpeedMulti: 0.8 },
    normal: { startTime: 180, trafficRate: 0.012, trafficSpeedMulti: 1.0 }, // 增倍車流
    hard: { startTime: 120, trafficRate: 0.025, trafficSpeedMulti: 1.5 }  // 增倍車流
};

// --- Global Game State ---
let GameState = {
    isRunning: false,
    carType: 'balanced',
    difficulty: 'normal',

    time: 0,
    dist: 0,
    coins: 0,
    maxRecordedSpeed: 0, // 新增：追蹤最高時速
    lastFrameTime: 0,

    keys: { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false, Space: false, w: false, a: false, s: false, d: false },
    touch: { left: false, right: false, brake: false, isMobile: false },

    offsetY: 0 // 背景捲動
};

// --- Input Handling ---
window.addEventListener('keydown', (e) => { GameState.keys[e.key] = true; GameState.keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { GameState.keys[e.key] = false; GameState.keys[e.key.toLowerCase()] = false; });

// Phone Touch Controls
document.getElementById('btn-left').addEventListener('touchstart', (e) => { e.preventDefault(); GameState.touch.left = true; GameState.touch.isMobile = true; });
document.getElementById('btn-left').addEventListener('touchend', (e) => { e.preventDefault(); GameState.touch.left = false; });
document.getElementById('btn-right').addEventListener('touchstart', (e) => { e.preventDefault(); GameState.touch.right = true; GameState.touch.isMobile = true; });
document.getElementById('btn-right').addEventListener('touchend', (e) => { e.preventDefault(); GameState.touch.right = false; });
document.getElementById('btn-brake').addEventListener('touchstart', (e) => { e.preventDefault(); GameState.touch.brake = true; });
document.getElementById('btn-brake').addEventListener('touchend', (e) => { e.preventDefault(); GameState.touch.brake = false; });
document.getElementById('btn-fire').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (GameState.isRunning) player.fireMissile();
});


// Resize Canvas
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ==========================================
// 實體系統 (Entities & Physics)
// ==========================================
class Entity {
    constructor(x, y, w, h) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.vx = 0;
        this.vy = 0;
        this.active = true;
    }

    // AABB Collision
    isCollidingWith(other) {
        return this.x < other.x + other.w &&
            this.x + this.w > other.x &&
            this.y < other.y + other.h &&
            this.y + this.h > other.y;
    }
}

class Player extends Entity {
    constructor() {
        // 車子放在畫面稍微高一點的地方，避免被下方虛擬按鍵擋住
        super(canvas.width / 2 - 20, canvas.height - 220, 40, 70);
        this.resetStats();
    }

    resetStats() {
        const stats = CAR_PRESETS[GameState.carType];
        this.hp = stats.hp;
        this.baseMaxSpeed = stats.maxSpeed;
        this.maxSpeed = stats.maxSpeed;
        this.accel = stats.accel;           // 加速度
        this.turnSpeed = stats.turnSpeed;
        this.color = stats.color;
        this.drag = 1 - (stats.accel / stats.maxSpeed); // 確保終端速度 = maxSpeed
        this.baseDrag = this.drag;
        this.driftInertia = stats.driftInertia; // 甩尾滑動保有的橫向速度

        this.ammo = 0;
        this.missileLevel = 1;
        this.fireCooldown = 0; // 射擊冷卻

        // 狀態與 Buff
        this.invincibleTimer = 0;
        this.shieldTimer = 0;
        this.boostTimer = 0;

        this.x = canvas.width / 2 - this.w;
        this.y = canvas.height - 220;
        this.vx = 0;
        this.vy = 0;
    }

    update(dt) {
        // --- 控制輸入 ---
        let thrust = 0;
        let turn = 0;

        // 鍵盤
        if (GameState.keys['ArrowUp'] || GameState.keys['w']) thrust = 1;
        if (GameState.keys['ArrowDown'] || GameState.keys['s']) thrust = -1;
        if (GameState.keys['ArrowLeft'] || GameState.keys['a']) turn = -1;
        if (GameState.keys['ArrowRight'] || GameState.keys['d']) turn = 1;

        // 手機預設常駐油門，除非按煞車
        if (GameState.touch.isMobile) {
            thrust = GameState.touch.brake ? -1 : 1;
            if (GameState.touch.left) turn = -1;
            if (GameState.touch.right) turn = 1;
        }

        // 飛彈連發 (hold 空白鍵可以持續射擊)
        this.fireCooldown -= dt;
        if ((GameState.keys[' '] || GameState.keys['Space']) && this.fireCooldown <= 0) {
            this.fireMissile();
            this.fireCooldown = 0.15; // 0.15秒一發
        }

        // --- 物理系統 ---
        // 縱向加速 - 每台車有獨立的加速度數值
        if (thrust > 0) {
            this.vy -= this.accel; // 向前 (Canvas Y負向)
        } else if (thrust < 0) {
            this.vy += 0.5; // 煞車
        }

        // 橫向控制 (甩尾慣性實作)
        if (turn !== 0) {
            // 提供橫向牽引力 (調小一點偏移幅度)
            this.vx += turn * this.turnSpeed * 0.05;
        }

        // 摩擦力 (阻力衰減)
        this.vy *= this.drag;
        // 橫向阻力比縱向大，除非處於冰原等打滑狀態。
        // driftInertia 越大，橫向速度衰減越慢(越滑)
        this.vx *= (1 - this.driftInertia);

        // 限制極速
        let currentMaxSpeed = this.maxSpeed;
        if (this.boostTimer > 0) currentMaxSpeed *= 2; // 衝刺期間兩倍速

        if (this.vy < -currentMaxSpeed) this.vy = -currentMaxSpeed;
        if (this.vy > currentMaxSpeed / 2) this.vy = currentMaxSpeed / 2; // 倒車慢一點

        // 邊界碰撞限制 (不扣血，單純阻擋)
        this.x += this.vx;
        if (this.x < 0) {
            this.x = 0;
            this.vx = 0;
            // 撞到邊界把動態消掉，但不呼叫 takeDamage
        } else if (this.x > canvas.width - this.w) {
            this.x = canvas.width - this.w;
            this.vx = 0;
        }

        // 玩家 Y 軸在螢幕上固定，前進速度轉化為整體遊戲背景的捲動速度
        // 計算方式：遊戲往前，攝影機往前的速度就等於 -this.vy (因為vy是負的代表往前)
        // 背景往下捲，跟車流往下的速度會與這個基準掛勾
        GameState.offsetY -= this.vy;

        // 只允許玩家在畫布下半部稍微移動（更低位置，但不被按鈕遮擋）
        this.y += this.vy * 0.1;
        if (this.y > canvas.height - 150) this.y = canvas.height - 150;
        if (this.y < canvas.height - 300) this.y = canvas.height - 300;

        // 計算真實距離
        if (this.vy < 0) {
            GameState.dist += Math.abs(this.vy) * 0.1;
        }

        // --- 狀態更新 ---
        if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
        if (this.shieldTimer > 0) this.shieldTimer -= dt;
        if (this.boostTimer > 0) this.boostTimer -= dt;
    }

    takeDamage(amount) {
        if (this.invincibleTimer > 0) return;

        // 護盾期間完全免疫傷害（持續到時間到）
        if (this.shieldTimer > 0) {
            this.invincibleTimer = 0.5;
            AudioSys.playCrash();
            showEffectNotice("護盾抵擋！");
            return;
        }

        this.hp -= amount;
        this.vy = 0;
        this.invincibleTimer = 2.0;
        AudioSys.playCrash();

        // 撞車時飛彈降級 (最低 Lv1)
        if (this.missileLevel > 1) {
            this.missileLevel--;
            showEffectNotice("血量 -1 | 飛彈降級！");
        } else {
            showEffectNotice("血量 -1");
        }
        updateHUD();

        // 若在衝刺中撞到，中斷衝刺
        if (this.boostTimer > 0) this.boostTimer = 0;

        if (this.hp <= 0) {
            endGame();
        }
    }

    fireMissile() {
        // 飛彈無限發射
        AudioSys.playMissileLaunch();

        if (this.missileLevel === 1) {
            missiles.push(new Missile(this.x + this.w / 2 - 5, this.y, 1));
        } else if (this.missileLevel === 2) {
            missiles.push(new Missile(this.x, this.y, 1));
            missiles.push(new Missile(this.x + this.w - 10, this.y, 1));
        } else if (GameState.carType === 'ultraman' && this.missileLevel >= 3) {
            // Lv3 奧特曼專屬: 斯佩修姆光線 + 散彈齊發
            let beam = new Missile(this.x + this.w / 2 - 15, this.y - 10, 3);
            beam.w = 30;
            beam.h = 80;
            beam.isBeam = true;
            beam.vy = -18;
            beam.damage = 5;
            missiles.push(beam);
            // 加上散彈
            for (let angle = -0.3; angle <= 0.3; angle += 0.15) {
                let m = new Missile(this.x + this.w / 2 - 5, this.y, 3);
                m.vx = Math.sin(angle) * 8;
                m.vy = -12 - Math.abs(angle) * 3;
                missiles.push(m);
            }
        } else {
            // Lv3: 散彈效果 (5 發扇形展開)
            for (let angle = -0.3; angle <= 0.3; angle += 0.15) {
                let m = new Missile(this.x + this.w / 2 - 5, this.y, 3);
                m.vx = Math.sin(angle) * 8;
                m.vy = -12 - Math.abs(angle) * 3;
                missiles.push(m);
            }
        }
        updateHUD();
    }

    draw(ctx) {
        // 閃爍的無敵狀態
        if (this.invincibleTimer > 0 && Math.floor(Date.now() / 100) % 2 === 0) return;

        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);

        // 根據橫向速度做一點傾斜視覺
        let tilt = this.vx * 0.04;
        ctx.rotate(tilt);

        const hw = this.w / 2;
        const hh = this.h / 2;

        if (GameState.carType === 'ultraman') {
            // ====== 初代奧特曼 - 頭部 ======

            // --- 銀色橢圓頭部 ---
            ctx.fillStyle = '#636e72';
            ctx.beginPath();
            ctx.ellipse(0, 0, hw + 2, hh + 2, 0, 0, Math.PI * 2);
            ctx.fill();
            let headG = ctx.createRadialGradient(-3, -hh * 0.2, 2, 0, 0, hh * 1.1);
            headG.addColorStop(0, '#ffffff');
            headG.addColorStop(0.35, '#ecf0f1');
            headG.addColorStop(0.7, '#bdc3c7');
            headG.addColorStop(1, '#7f8c8d');
            ctx.fillStyle = headG;
            ctx.beginPath();
            ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
            ctx.fill();

            // --- 下巴 (銀灰色平底, 不是橢圓) ---
            ctx.fillStyle = '#95a5a6';
            ctx.beginPath();
            ctx.moveTo(-hw * 0.45, hh * 0.7);
            ctx.lineTo(hw * 0.45, hh * 0.7);
            ctx.lineTo(hw * 0.25, hh);
            ctx.lineTo(-hw * 0.25, hh);
            ctx.closePath();
            ctx.fill();

            // --- 中央脊鰭 (更高更突出) ---
            ctx.fillStyle = '#95a5a6';
            ctx.beginPath();
            ctx.moveTo(0, -hh - 14);
            ctx.lineTo(-6, hh * 0.15);
            ctx.lineTo(6, hh * 0.15);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#dfe6e9';
            ctx.beginPath();
            ctx.moveTo(0, -hh - 12);
            ctx.lineTo(-4, hh * 0.1);
            ctx.lineTo(4, hh * 0.1);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.beginPath();
            ctx.moveTo(0, -hh - 10);
            ctx.lineTo(-1.5, hh * 0.05);
            ctx.lineTo(1.5, hh * 0.05);
            ctx.closePath();
            ctx.fill();

            // --- 黃色眼睛 (較暗的色調) ---
            ctx.shadowColor = '#c29d0b';
            ctx.shadowBlur = 10;
            ctx.save();
            ctx.translate(-hw * 0.52, -hh * 0.15);
            ctx.rotate(-Math.PI / 4);
            let eg1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
            eg1.addColorStop(0, '#f5e6b8');
            eg1.addColorStop(0.4, '#d4a817');
            eg1.addColorStop(1, '#b8860b');
            ctx.fillStyle = eg1;
            ctx.beginPath();
            ctx.ellipse(0, 0, 4.5, 12, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            ctx.save();
            ctx.translate(hw * 0.52, -hh * 0.15);
            ctx.rotate(Math.PI / 4);
            let eg2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
            eg2.addColorStop(0, '#f5e6b8');
            eg2.addColorStop(0.4, '#d4a817');
            eg2.addColorStop(1, '#b8860b');
            ctx.fillStyle = eg2;
            ctx.beginPath();
            ctx.ellipse(0, 0, 4.5, 12, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            ctx.shadowBlur = 0;

            // --- 嘴巴 ---
            ctx.strokeStyle = '#636e72';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-hw * 0.3, hh * 0.45);
            ctx.quadraticCurveTo(0, hh * 0.55, hw * 0.3, hh * 0.45);
            ctx.stroke();

        } else {
            // === 一般車輛繪圖 ===
            // === 輪胎 ===
            ctx.fillStyle = '#1a1a1a';
            // 前輪
            ctx.fillRect(-hw - 4, -hh + 8, 6, 16);
            ctx.fillRect(hw - 2, -hh + 8, 6, 16);
            // 後輪
            ctx.fillRect(-hw - 4, hh - 24, 6, 16);
            ctx.fillRect(hw - 2, hh - 24, 6, 16);
            // 輪胎高光
            ctx.fillStyle = '#444';
            ctx.fillRect(-hw - 3, -hh + 10, 2, 12);
            ctx.fillRect(hw - 1, -hh + 10, 2, 12);
            ctx.fillRect(-hw - 3, hh - 22, 2, 12);
            ctx.fillRect(hw - 1, hh - 22, 2, 12);

            // === 車身底色 (圓角) ===
            ctx.beginPath();
            const r = 6;
            ctx.moveTo(-hw + r, -hh);
            ctx.lineTo(hw - r, -hh);
            ctx.quadraticCurveTo(hw, -hh, hw, -hh + r);
            ctx.lineTo(hw, hh - r);
            ctx.quadraticCurveTo(hw, hh, hw - r, hh);
            ctx.lineTo(-hw + r, hh);
            ctx.quadraticCurveTo(-hw, hh, -hw, hh - r);
            ctx.lineTo(-hw, -hh + r);
            ctx.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
            ctx.closePath();
            ctx.fillStyle = this.color;
            ctx.fill();

            // === 金屬漸層高光 ===
            let grad = ctx.createLinearGradient(-hw, 0, hw, 0);
            grad.addColorStop(0, 'rgba(255,255,255,0.15)');
            grad.addColorStop(0.4, 'rgba(255,255,255,0.05)');
            grad.addColorStop(0.6, 'rgba(255,255,255,0.05)');
            grad.addColorStop(1, 'rgba(0,0,0,0.15)');
            ctx.fillStyle = grad;
            ctx.fill();

            // === 賽車條紋 ===
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(-3, -hh + 2, 6, this.h - 4);

            // === 擋風玻璃 ===
            ctx.beginPath();
            ctx.moveTo(-hw + 5, -hh + 12);
            ctx.lineTo(hw - 5, -hh + 12);
            ctx.lineTo(hw - 7, -hh + 28);
            ctx.lineTo(-hw + 7, -hh + 28);
            ctx.closePath();
            let glassGrad = ctx.createLinearGradient(0, -hh + 12, 0, -hh + 28);
            glassGrad.addColorStop(0, '#2c3e50');
            glassGrad.addColorStop(1, '#1a252f');
            ctx.fillStyle = glassGrad;
            ctx.fill();
            // 玻璃反光
            ctx.fillStyle = 'rgba(100,180,255,0.2)';
            ctx.fillRect(-hw + 7, -hh + 14, (this.w - 14) * 0.4, 6);

            // === 後擋風玻璃 ===
            ctx.fillStyle = '#1a252f';
            ctx.fillRect(-hw + 6, hh - 22, this.w - 12, 12);

            // === 前車燈 ===
            ctx.fillStyle = '#ffffaa';
            ctx.shadowColor = '#ffffaa';
            ctx.shadowBlur = 8;
            ctx.fillRect(-hw + 3, -hh + 2, 8, 5);
            ctx.fillRect(hw - 11, -hh + 2, 8, 5);
            ctx.shadowBlur = 0;

            // === 尾燈 ===
            ctx.fillStyle = '#ff3333';
            ctx.shadowColor = '#ff3333';
            ctx.shadowBlur = 6;
            ctx.fillRect(-hw + 3, hh - 6, 8, 4);
            ctx.fillRect(hw - 11, hh - 6, 8, 4);
            ctx.shadowBlur = 0;
        }

        // === 護盾效果 ===
        if (this.shieldTimer > 0) {
            ctx.strokeStyle = '#00d2d3';
            ctx.lineWidth = 3;
            ctx.shadowColor = '#00d2d3';
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.ellipse(0, 0, hw + 10, hh + 10, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(0, 210, 211, 0.1)';
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // === 衝刺尾焰 ===
        if (this.boostTimer > 0) {
            ctx.shadowColor = '#f39c12';
            ctx.shadowBlur = 12;
            // 左尾焰
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath();
            ctx.moveTo(-hw + 6, hh);
            ctx.lineTo(-hw + 16, hh);
            ctx.lineTo(-hw + 11, hh + 18 + Math.random() * 18);
            ctx.closePath();
            ctx.fill();
            // 右尾焰
            ctx.beginPath();
            ctx.moveTo(hw - 16, hh);
            ctx.lineTo(hw - 6, hh);
            ctx.lineTo(hw - 11, hh + 18 + Math.random() * 18);
            ctx.closePath();
            ctx.fill();
            // 內焰
            ctx.fillStyle = '#e74c3c';
            ctx.beginPath();
            ctx.moveTo(-hw + 8, hh);
            ctx.lineTo(-hw + 14, hh);
            ctx.lineTo(-hw + 11, hh + 10 + Math.random() * 10);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(hw - 14, hh);
            ctx.lineTo(hw - 8, hh);
            ctx.lineTo(hw - 11, hh + 10 + Math.random() * 10);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        ctx.restore();
    }
}

class Missile extends Entity {
    constructor(x, y, level) {
        super(x, y, level === 3 ? 20 : 10, level === 3 ? 40 : 20);
        this.level = level;
        this.vy = -15; // 絕對速度往前飛
        this.damage = level;
    }

    update() {
        // 飛彈移動 (含橫向散射速度)
        this.x += this.vx || 0;
        this.y += this.vy + player.vy;
        if (this.y < -100 || this.x < -50 || this.x > canvas.width + 50) this.active = false;
    }

    draw(ctx) {
        // 奧特曼 Spacium Beam 光波特效
        if (this.isBeam) {
            ctx.save();
            let cx = this.x + this.w / 2;
            let cy = this.y + this.h / 2;
            // 外層發光
            let beamGrad = ctx.createLinearGradient(cx - this.w, cy, cx + this.w, cy);
            beamGrad.addColorStop(0, 'rgba(100,200,255,0)');
            beamGrad.addColorStop(0.3, 'rgba(100,200,255,0.6)');
            beamGrad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
            beamGrad.addColorStop(0.7, 'rgba(100,200,255,0.6)');
            beamGrad.addColorStop(1, 'rgba(100,200,255,0)');
            ctx.fillStyle = beamGrad;
            ctx.shadowColor = '#5dade2';
            ctx.shadowBlur = 25;
            ctx.fillRect(this.x - 5, this.y, this.w + 10, this.h);
            // 內層白色核心
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fillRect(this.x + this.w * 0.25, this.y, this.w * 0.5, this.h);
            // 動態波紋
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 3; i++) {
                let yOff = (Date.now() / 50 + i * 25) % this.h;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y + yOff);
                ctx.lineTo(this.x + this.w, this.y + yOff);
                ctx.stroke();
            }
            ctx.shadowBlur = 0;
            ctx.restore();
            return;
        }
        ctx.fillStyle = this.level === 3 ? '#e74c3c' : '#f1c40f';
        ctx.fillRect(this.x, this.y, this.w, this.h);

        ctx.fillStyle = '#ff9f43';
        ctx.fillRect(this.x + this.w / 2 - 2, this.y + this.h, 4, 10 + Math.random() * 10);
    }
}

class Traffic extends Entity {
    constructor(x, y, w, h, isFast, color) {
        super(x, y, w, h);
        this.isFast = isFast;
        this.color = color;
        // 定義每一台車「世界座標」中的絕對速度。
        // 玩家不動時：慢車往前開 (y負向)，快車往後衝(y正向, 逆向)
        // 這個 baseVy 代表「相對於靜止地面」的速度
        this.baseVy = isFast ? 3 : -4;
        this.hp = isFast ? 1 : 2;
    }

    update() {
        // 真實呈現在螢幕上的 Y 軸移動 = 自己對地的速度 + 玩家的前進速度補償
        // 注意：玩家前進時 this.vy 是負值。為了讓攝影機(玩家)感覺在前進，
        // 所有的世界物件都應該受到 +Math.abs(player.vy) 的往下(正Y)推力才對。
        this.y += this.baseVy - player.vy;

        // 如果離開畫面太遠，則移除
        if (this.y > canvas.height + 200 || this.y < -800) {
            this.active = false;
        }
    }

    takeDamage(amo) {
        this.hp -= amo;
        if (this.hp <= 0) {
            this.active = false;
            AudioSys.playExplosion();

            // 摧毀敵車機率掉寶 (30% 掉落)
            if (Math.random() < 0.3) {
                spawnDrop(this.x, this.y);
            }
        } else {
            AudioSys.playCrash(); // 打到沒死
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);

        const hw = this.w / 2;
        const hh = this.h / 2;

        // 輪胎
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(-hw - 3, -hh + 6, 5, 14);
        ctx.fillRect(hw - 2, -hh + 6, 5, 14);
        ctx.fillRect(-hw - 3, hh - 20, 5, 14);
        ctx.fillRect(hw - 2, hh - 20, 5, 14);

        // 車身 (圓角)
        ctx.beginPath();
        const r = 5;
        ctx.moveTo(-hw + r, -hh);
        ctx.lineTo(hw - r, -hh);
        ctx.quadraticCurveTo(hw, -hh, hw, -hh + r);
        ctx.lineTo(hw, hh - r);
        ctx.quadraticCurveTo(hw, hh, hw - r, hh);
        ctx.lineTo(-hw + r, hh);
        ctx.quadraticCurveTo(-hw, hh, -hw, hh - r);
        ctx.lineTo(-hw, -hh + r);
        ctx.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
        ctx.closePath();
        ctx.fillStyle = this.color;
        ctx.fill();

        // 金屬感
        let grad = ctx.createLinearGradient(-hw, 0, hw, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0.12)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = grad;
        ctx.fill();

        // 擋風玻璃
        ctx.fillStyle = '#1a252f';
        if (this.isFast) {
            ctx.fillRect(-hw + 4, hh - 18, this.w - 8, 12);
            // 前燈 (對向車燈在下方)
            ctx.fillStyle = '#ffffaa';
            ctx.shadowColor = '#ffffaa';
            ctx.shadowBlur = 6;
            ctx.fillRect(-hw + 3, hh - 4, 7, 3);
            ctx.fillRect(hw - 10, hh - 4, 7, 3);
            ctx.shadowBlur = 0;
        } else {
            ctx.fillRect(-hw + 4, -hh + 6, this.w - 8, 12);
            // 尾燈 (同向車尾燈在下方)
            ctx.fillStyle = '#ff3333';
            ctx.shadowColor = '#ff3333';
            ctx.shadowBlur = 4;
            ctx.fillRect(-hw + 3, hh - 4, 7, 3);
            ctx.fillRect(hw - 10, hh - 4, 7, 3);
            ctx.shadowBlur = 0;
        }

        ctx.restore();

        // 血條
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(this.x, this.y - 10, this.w, 4);
        ctx.fillStyle = '#2ecc71';
        let hpRatio = this.hp / (this.isFast ? 1 : 2);
        ctx.fillRect(this.x, this.y - 10, this.w * hpRatio, 4);
    }
}

class Item extends Entity {
    constructor(x, y, type) {
        super(x, y, 45, 45);
        this.type = type; // 'coin', 'time', 'missile', 'shield', 'boost', 'hp'
        this.vy = 0; // 靜止在原地隨背景捲動
    }

    update() {
        // 道具靜止在地上，隨攝影機前進而往下捲動
        this.y += -player.vy;
        if (this.y > canvas.height + 100) this.active = false;
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);

        // 光暈效果
        ctx.shadowBlur = 15;

        // 浮動動畫 (上下微幅擺動)
        let floatY = Math.sin(Date.now() / 300) * 3;
        ctx.translate(0, floatY);

        if (this.type === 'coin') {
            ctx.shadowColor = '#f1c40f';
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#f39c12';
            ctx.beginPath();
            ctx.arc(0, 0, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('$', 0, 1);
        } else if (this.type === 'time') {
            ctx.shadowColor = '#3498db';
            ctx.fillStyle = '#3498db';
            ctx.fillRect(-12, -18, 24, 36);
            ctx.fillStyle = '#ecf0f1';
            ctx.beginPath();
            ctx.moveTo(-12, -18); ctx.lineTo(12, -18); ctx.lineTo(0, 0);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-12, 18); ctx.lineTo(12, 18); ctx.lineTo(0, 0);
            ctx.fill();
        } else if (this.type === 'missile') {
            ctx.shadowColor = '#e74c3c';
            ctx.fillStyle = '#e74c3c';
            ctx.fillRect(-10, -18, 20, 36);
            ctx.fillStyle = '#c0392b';
            ctx.beginPath();
            ctx.moveTo(-10, -18); ctx.lineTo(10, -18); ctx.lineTo(0, -28);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('M', 0, 2);
        } else if (this.type === 'shield') {
            ctx.shadowColor = '#00d2d3';
            ctx.strokeStyle = '#00d2d3';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(0, 210, 211, 0.5)';
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('S', 0, 1);
        } else if (this.type === 'boost') {
            ctx.shadowColor = '#ff9f43';
            ctx.fillStyle = '#ff9f43';
            ctx.beginPath();
            ctx.moveTo(0, -18);
            ctx.lineTo(18, 6);
            ctx.lineTo(6, 6);
            ctx.lineTo(6, 22);
            ctx.lineTo(-6, 22);
            ctx.lineTo(-6, 6);
            ctx.lineTo(-18, 6);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('B', 0, 6);
        } else if (this.type === 'hp') {
            ctx.shadowColor = '#e74c3c';
            ctx.fillStyle = '#e74c3c';
            ctx.font = 'bold 32px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('❤', 0, 0);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText('+1', 0, 18);
        }

        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

class Terrain extends Entity {
    constructor(x, y, w, h, type) {
        super(x, y, w, h);
        this.type = type; // 'mud', 'ice'
    }

    update() {
        this.y += -player.vy;
        if (this.y > canvas.height + 200) this.active = false;
    }

    draw(ctx) {
        ctx.save();

        if (this.type === 'mud') {
            // 泥濞區域底色
            ctx.fillStyle = 'rgba(92, 64, 51, 0.6)';
            ctx.beginPath();
            ctx.ellipse(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, this.h / 2, 0, 0, Math.PI * 2);
            ctx.fill();

            // 在泥濞上畫多個向下箭頭符號 (象徵減速)
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            let cols = Math.max(1, Math.floor(this.w / 50));
            let rows = Math.max(1, Math.floor(this.h / 50));
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    let ax = this.x + (c + 0.5) * (this.w / cols);
                    let ay = this.y + (r + 0.5) * (this.h / rows);
                    ctx.fillText('▼', ax, ay);
                }
            }

            // 邊緣文字提示
            ctx.fillStyle = '#ffcc00';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText('減速', this.x + this.w / 2, this.y - 5);

        } else if (this.type === 'ice') {
            // 冰原區域底色
            ctx.fillStyle = 'rgba(100, 200, 255, 0.35)';
            ctx.beginPath();
            ctx.ellipse(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, this.h / 2, 0, 0, Math.PI * 2);
            ctx.fill();

            // 邊緣虹光
            ctx.strokeStyle = 'rgba(150, 220, 255, 0.6)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, this.h / 2, 0, 0, Math.PI * 2);
            ctx.stroke();

            // 在冰原上畫雪花符號 (❄) 象徵打滑
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 30px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            let iceCols = Math.max(1, Math.floor(this.w / 55));
            let iceRows = Math.max(1, Math.floor(this.h / 55));
            for (let r = 0; r < iceRows; r++) {
                for (let c = 0; c < iceCols; c++) {
                    let ax = this.x + (c + 0.5) * (this.w / iceCols);
                    let ay = this.y + (r + 0.5) * (this.h / iceRows);
                    ctx.fillText('❄', ax, ay);
                }
            }

            // 邊緣文字提示
            ctx.fillStyle = '#80d4ff';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText('打滑', this.x + this.w / 2, this.y - 5);
        }

        ctx.restore();
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10;
        this.life = 1.0;
        this.color = color;
    }
    update(dt) {
        this.x += this.vx;
        this.y += this.vy - player.vy;
        this.life -= dt * 2;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, 5, 5);
        ctx.globalAlpha = 1.0;
    }
}

function spawnDrop(x, y) {
    const r = Math.random();
    let type = 'coin'; // 60%
    if (r > 0.6 && r <= 0.8) type = 'time'; // 20%
    else if (r > 0.8) type = 'missile'; // 20%
    items.push(new Item(x + 10, y + 10, type));
}

function createExplosion(x, y, color) {
    for (let i = 0; i < 30; i++) {
        particles.push(new Particle(x, y, color));
    }
}

// ==========================================
// 初始化與迴圈
// ==========================================

let player;
let missiles = [];
let enemies = [];
let items = [];
let terrains = [];
let particles = [];

function initGame() {
    AudioSys.init();

    // 如果 AudioContext 被瀏覽器鎖住(需要交互才能播放)，在 init() 內會啟動
    // 這裡我們直接呼叫開始
    AudioSys.startEngine();
    AudioSys.startBGM();

    player = new Player();
    missiles = [];
    enemies = [];
    items = [];
    terrains = [];
    particles = [];

    const diff = DIFF_PRESETS[GameState.difficulty];
    GameState.time = diff.startTime;
    GameState.dist = 0;
    GameState.coins = 0;
    GameState.offsetY = 0;
    GameState.maxRecordedSpeed = 0; // 重置最高時速
    GameState.lastFrameTime = performance.now();
    GameState.isRunning = true;

    screens.menu.classList.remove('active');
    screens.game.classList.add('active');

    updateHUD();
    requestAnimationFrame(gameLoop);
}

function endGame() {
    GameState.isRunning = false;
    AudioSys.stopEngine();
    AudioSys.stopBGM();

    screens.game.classList.remove('active');
    screens.gameOver.classList.add('active');
    document.getElementById('go-dist').innerText = (GameState.dist / 1000).toFixed(2);
    document.getElementById('go-max-speed').innerText = GameState.maxRecordedSpeed; // 顯示最高時速
}

function showEffectNotice(text) {
    effectNotice.innerText = text;
    effectNotice.style.opacity = 1;
    setTimeout(() => { effectNotice.style.opacity = 0; }, 2000);
}

function updateHUD() {
    hud.hp.innerText = player.hp;
    hud.dist.innerText = Math.floor(GameState.dist);
    // 加上基礎速度與稍微調整顯示比例，讓時速變化更符合一般認知
    let kmh = Math.round(Math.abs(player.vy) * 12);
    if (kmh > GameState.maxRecordedSpeed) {
        GameState.maxRecordedSpeed = kmh; // 記錄最高時速
    }
    hud.speed.innerText = kmh;
    hud.ammo.innerText = 'Lv.' + player.missileLevel;
    hud.coins.innerText = GameState.coins;
    // Time 放在 loop 裡面跑

    // 護盾/衝刺倒數顯示
    let statusText = '';
    if (player.shieldTimer > 0) statusText += '🛡️ ' + Math.ceil(player.shieldTimer) + 's ';
    if (player.boostTimer > 0) statusText += '⚡ ' + Math.ceil(player.boostTimer) + 's';
    if (statusText && effectNotice.style.opacity == 0) {
        effectNotice.innerText = statusText;
        effectNotice.style.opacity = 0.6;
        effectNotice.style.fontSize = '1.5rem';
    } else if (!statusText && effectNotice.style.fontSize === '1.5rem') {
        effectNotice.style.opacity = 0;
        effectNotice.style.fontSize = '3rem';
    }
}

function gameLoop(currentTime) {
    if (!GameState.isRunning) return;

    const dt = (currentTime - GameState.lastFrameTime) / 1000;
    GameState.lastFrameTime = currentTime;

    // Time Management
    GameState.time -= dt;
    if (GameState.time <= 0) {
        GameState.time = 0;
        endGame();
    }
    hud.time.innerText = GameState.time.toFixed(1);

    update(dt);
    draw();

    requestAnimationFrame(gameLoop);
}

function update(dt) {
    // 檢查地形踩踏
    let onMud = false;
    let onIce = false;
    terrains.forEach(t => {
        if (player.isCollidingWith(t)) {
            if (t.type === 'mud') onMud = true;
            if (t.type === 'ice') onIce = true;
        }
    });

    // 套用地形狀態修飾
    player.maxSpeed = player.baseMaxSpeed * (onMud ? 0.5 : 1.0);
    // 重新計算 drag 以確保終端速度 = 當前 maxSpeed
    player.drag = 1 - (player.accel / player.maxSpeed);
    player.driftInertia = onIce ? 0.8 : CAR_PRESETS[GameState.carType].driftInertia;
    if (onIce) player.drag = 0.99; // 冰面低摩擦

    player.update(dt);

    // 把目前的相對速度比率傳給音效系統改變音調
    let speedRatio = Math.abs(player.vy) / player.baseMaxSpeed;
    AudioSys.updateEngineSpeed(speedRatio);

    // 生成車流 (Spawner)
    const diff = DIFF_PRESETS[GameState.difficulty];
    if (Math.random() < diff.trafficRate) {
        let isFast = Math.random() < (GameState.difficulty === 'hard' ? 0.4 : 0.15);
        let w = isFast ? 35 : 45;
        let h = isFast ? 60 : 80;
        // 限制車輛生成在路面範圍內 (道路兩側留邊)
        let roadLeft = 30;
        let roadRight = canvas.width - 30 - w;
        let x = roadLeft + Math.random() * (roadRight - roadLeft);
        let y = -200;
        let color = isFast ? '#8e44ad' : '#27ae60';

        let overlap = enemies.some(e => Math.abs(e.x - x) < 60 && e.y < 0);
        if (!overlap) enemies.push(new Traffic(x, y, w, h, isFast, color));
    }

    // 生成路面道具 (金幣、沙漏、愛心會在路上隨機出現)
    if (Math.random() < 0.008) {
        let r = Math.random();
        let type = r < 0.6 ? 'coin' : (r < 0.85 ? 'time' : 'hp');
        items.push(new Item(30 + Math.random() * (canvas.width - 90), -80, type));
    }
    // 生成飛彈箱 (比金幣稀有)
    if (Math.random() < 0.003) {
        items.push(new Item(30 + Math.random() * (canvas.width - 90), -80, 'missile'));
    }

    // 生成地形 (泥濞/冰原)
    if (Math.random() < 0.003) {
        let type = Math.random() < 0.5 ? 'mud' : 'ice';
        terrains.push(new Terrain(Math.random() * canvas.width, -300, 120 + Math.random() * 80, 100 + Math.random() * 80, type));
    }
    // 生成稀有道具 (護盾/衝刺)
    if (Math.random() < 0.001) {
        let type = Math.random() < 0.5 ? 'shield' : 'boost';
        items.push(new Item(30 + Math.random() * (canvas.width - 90), -80, type));
    }

    // 更新並過濾無效實體
    missiles.forEach(m => m.update());
    missiles = missiles.filter(m => m.active);

    enemies.forEach(e => e.update());
    enemies = enemies.filter(e => e.active);

    items.forEach(i => i.update());
    items = items.filter(i => i.active);

    terrains.forEach(t => t.update());
    terrains = terrains.filter(t => t.active);

    particles.forEach(p => p.update(dt));
    particles = particles.filter(p => p.life > 0);

    // 碰撞偵測 (Collision Engine)
    // 1. 玩家撞車
    enemies.forEach(e => {
        if (player.isCollidingWith(e)) {
            player.takeDamage(1);
            if (player.boostTimer > 0) {
                // 如果在衝刺狀態，可以直接把敵車撞飛（但自己會受傷中斷）
                e.takeDamage(10);
            }
        }
    });

    // 2. 飛彈打車
    missiles.forEach(m => {
        enemies.forEach(e => {
            if (m.active && e.active && m.isCollidingWith(e)) {
                // 飛彈命中
                m.active = false;
                e.takeDamage(m.damage);
                createExplosion(e.x + e.w / 2, e.y + e.h / 2, '#e74c3c');
            }
        });
    });

    // 3. 玩家吃道具
    items.forEach(i => {
        if (player.isCollidingWith(i)) {
            i.active = false;
            AudioSys.playPowerUp();

            if (i.type === 'coin') {
                GameState.coins++;
                showEffectNotice("金幣 +1");
                if (GameState.coins >= 5) {
                    GameState.coins -= 5;
                    player.baseMaxSpeed += 2;
                    player.accel += 0.04; // 加速度也同步提升
                    player.boostTimer = Math.max(player.boostTimer, 3.0);
                    showEffectNotice("極速顯著提升！！");
                }
            } else if (i.type === 'time') {
                GameState.time += 3;
                showEffectNotice("時間 +3秒");
            } else if (i.type === 'missile') {
                // 吃到飛彈箱 = 升級
                player.missileLevel = Math.min(3, player.missileLevel + 1);
                showEffectNotice('飛彈升級 Lv.' + player.missileLevel + '！');
            } else if (i.type === 'shield') {
                player.shieldTimer = 20.0;
                showEffectNotice("護盾啟動！20秒！");
            } else if (i.type === 'boost') {
                player.boostTimer = 10.0;
                showEffectNotice("衝刺啟動！10秒！");
            } else if (i.type === 'hp') {
                player.hp += 1;
                showEffectNotice("血量 +1！");
            }
        }
    });

    updateHUD();
}

function draw() {
    // 畫布背景 (柏油地)
    ctx.fillStyle = '#2d3436';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 道路兩側邊線 (白色實線)
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 4;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(20, canvas.height);
    ctx.moveTo(canvas.width - 20, 0);
    ctx.lineTo(canvas.width - 20, canvas.height);
    ctx.stroke();

    // 道路中央虛線
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.setLineDash([40, 40]);
    ctx.beginPath();

    // 讓線條跟著背景捲動 offsetY，產生往前開的錯覺
    let lineOffset = GameState.offsetY % 80;

    ctx.moveTo(canvas.width / 3, -80 + lineOffset);
    ctx.lineTo(canvas.width / 3, canvas.height + 80);

    ctx.moveTo(2 * canvas.width / 3, -80 + lineOffset);
    ctx.lineTo(2 * canvas.width / 3, canvas.height + 80);
    ctx.stroke();

    // 重設 dash
    ctx.setLineDash([]);

    // Entities Draw calls (順序: 地形 -> 道具 -> 車流 -> 玩家 -> 飛彈 -> 粒子特效)
    terrains.forEach(t => t.draw(ctx));
    items.forEach(i => i.draw(ctx));
    enemies.forEach(e => e.draw(ctx));
    player.draw(ctx);
    missiles.forEach(m => m.draw(ctx));
    particles.forEach(p => p.draw(ctx));

    // 如果衝刺，疊加速度感特效
    if (player.boostTimer > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.08})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // 邊緣動態模糊
        ctx.fillStyle = 'rgba(255, 200, 0, 0.15)';
        ctx.fillRect(0, 0, 30, canvas.height);
        ctx.fillRect(canvas.width - 30, 0, 30, canvas.height);
    }

    // 如果護盾啟動，畫一個淡藍色顯示
    if (player.shieldTimer > 0) {
        ctx.strokeStyle = 'rgba(0, 210, 211, 0.15)';
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
    }
}

// --- Menu Logic ---
document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        GameState.difficulty = btn.dataset.diff;

        const descs = {
            easy: '起始時間充裕。車流密度低。速度較慢。',
            normal: '標準平衡體驗。',
            hard: '起始時間緊迫。車流密集。節奏極快。'
        };
        document.getElementById('diff-desc').innerText = descs[GameState.difficulty];
    });
});

document.querySelectorAll('.car-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.car-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        GameState.carType = card.dataset.car;
    });
});

document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('virtual-controls').classList.add('force-show');
    initGame();
});

document.getElementById('restart-btn').addEventListener('click', () => {
    screens.gameOver.classList.remove('active');
    screens.menu.classList.add('active');
});

// ==========================================
// 選單車輛預覽 (Canvas 版)
// ==========================================
function drawCarPreview(canvasId, carType, color, carW, carH) {
    const c = document.getElementById(canvasId);
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);

    const cx = c.width / 2;
    const cy = c.height / 2;
    const hw = carW / 2;
    const hh = carH / 2;

    ctx.save();
    ctx.translate(cx, cy);

    if (carType === 'ultraman') {
        // ====== 初代奧特曼 - 頭部 (預覽) ======

        ctx.fillStyle = '#636e72';
        ctx.beginPath();
        ctx.ellipse(0, 0, hw + 2, hh + 2, 0, 0, Math.PI * 2);
        ctx.fill();
        let headG = ctx.createRadialGradient(-3, -hh * 0.2, 2, 0, 0, hh * 1.1);
        headG.addColorStop(0, '#ffffff');
        headG.addColorStop(0.35, '#ecf0f1');
        headG.addColorStop(0.7, '#bdc3c7');
        headG.addColorStop(1, '#7f8c8d');
        ctx.fillStyle = headG;
        ctx.beginPath();
        ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
        ctx.fill();

        // 下巴
        ctx.fillStyle = '#95a5a6';
        ctx.beginPath();
        ctx.moveTo(-hw * 0.45, hh * 0.7);
        ctx.lineTo(hw * 0.45, hh * 0.7);
        ctx.lineTo(hw * 0.25, hh);
        ctx.lineTo(-hw * 0.25, hh);
        ctx.closePath();
        ctx.fill();

        // 脊鰭 (更高)
        ctx.fillStyle = '#95a5a6';
        ctx.beginPath();
        ctx.moveTo(0, -hh - 14);
        ctx.lineTo(-6, hh * 0.15);
        ctx.lineTo(6, hh * 0.15);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#dfe6e9';
        ctx.beginPath();
        ctx.moveTo(0, -hh - 12);
        ctx.lineTo(-4, hh * 0.1);
        ctx.lineTo(4, hh * 0.1);
        ctx.closePath();
        ctx.fill();

        // 眼睛 (暗色調)
        ctx.shadowColor = '#c29d0b';
        ctx.shadowBlur = 10;
        ctx.save();
        ctx.translate(-hw * 0.52, -hh * 0.15);
        ctx.rotate(-Math.PI / 4);
        let eg1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
        eg1.addColorStop(0, '#f5e6b8');
        eg1.addColorStop(0.4, '#d4a817');
        eg1.addColorStop(1, '#b8860b');
        ctx.fillStyle = eg1;
        ctx.beginPath();
        ctx.ellipse(0, 0, 4.5, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.translate(hw * 0.52, -hh * 0.15);
        ctx.rotate(Math.PI / 4);
        let eg2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
        eg2.addColorStop(0, '#f5e6b8');
        eg2.addColorStop(0.4, '#d4a817');
        eg2.addColorStop(1, '#b8860b');
        ctx.fillStyle = eg2;
        ctx.beginPath();
        ctx.ellipse(0, 0, 4.5, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.shadowBlur = 0;

        // 嘴巴
        ctx.strokeStyle = '#636e72';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-hw * 0.3, hh * 0.45);
        ctx.quadraticCurveTo(0, hh * 0.55, hw * 0.3, hh * 0.45);
        ctx.stroke();

    } else {

        // 輪胎
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(-hw - 4, -hh + 8, 6, 14);
        ctx.fillRect(hw - 2, -hh + 8, 6, 14);
        ctx.fillRect(-hw - 4, hh - 22, 6, 14);
        ctx.fillRect(hw - 2, hh - 22, 6, 14);
        // 輪胎高光
        ctx.fillStyle = '#444';
        ctx.fillRect(-hw - 3, -hh + 10, 2, 10);
        ctx.fillRect(hw - 1, -hh + 10, 2, 10);
        ctx.fillRect(-hw - 3, hh - 20, 2, 10);
        ctx.fillRect(hw - 1, hh - 20, 2, 10);

        // 車身 (圓角)
        const r = 5;
        ctx.beginPath();
        ctx.moveTo(-hw + r, -hh);
        ctx.lineTo(hw - r, -hh);
        ctx.quadraticCurveTo(hw, -hh, hw, -hh + r);
        ctx.lineTo(hw, hh - r);
        ctx.quadraticCurveTo(hw, hh, hw - r, hh);
        ctx.lineTo(-hw + r, hh);
        ctx.quadraticCurveTo(-hw, hh, -hw, hh - r);
        ctx.lineTo(-hw, -hh + r);
        ctx.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        // 金屬漸層
        let grad = ctx.createLinearGradient(-hw, 0, hw, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0.2)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.05)');
        grad.addColorStop(0.6, 'rgba(255,255,255,0.05)');
        grad.addColorStop(1, 'rgba(0,0,0,0.2)');
        ctx.fillStyle = grad;
        ctx.fill();

        // 賽車條紋
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(-2, -hh + 2, 4, carH - 4);

        // 擋風玻璃
        ctx.beginPath();
        ctx.moveTo(-hw + 4, -hh + 10);
        ctx.lineTo(hw - 4, -hh + 10);
        ctx.lineTo(hw - 6, -hh + 24);
        ctx.lineTo(-hw + 6, -hh + 24);
        ctx.closePath();
        let glassGrad = ctx.createLinearGradient(0, -hh + 10, 0, -hh + 24);
        glassGrad.addColorStop(0, '#2c3e50');
        glassGrad.addColorStop(1, '#1a252f');
        ctx.fillStyle = glassGrad;
        ctx.fill();
        // 玻璃反光
        ctx.fillStyle = 'rgba(100,180,255,0.25)';
        ctx.fillRect(-hw + 6, -hh + 12, (carW - 12) * 0.4, 5);

        // 後擋風玻璃
        ctx.fillStyle = '#1a252f';
        ctx.fillRect(-hw + 5, hh - 20, carW - 10, 10);

        // 前車燈
        ctx.fillStyle = '#ffffaa';
        ctx.shadowColor = '#ffffaa';
        ctx.shadowBlur = 8;
        ctx.fillRect(-hw + 3, -hh + 2, 7, 4);
        ctx.fillRect(hw - 10, -hh + 2, 7, 4);
        ctx.shadowBlur = 0;

        // 尾燈
        ctx.fillStyle = '#ff3333';
        ctx.shadowColor = '#ff3333';
        ctx.shadowBlur = 6;
        ctx.fillRect(-hw + 3, hh - 5, 7, 3);
        ctx.fillRect(hw - 10, hh - 5, 7, 3);
        ctx.shadowBlur = 0;

    }
    ctx.restore();
}

// 畫全預覽車
drawCarPreview('preview-balanced', 'balanced', '#3498db', 32, 56);
drawCarPreview('preview-heavy', 'heavy', '#e67e22', 38, 64);
drawCarPreview('preview-sports', 'sports', '#e74c3c', 28, 52);
drawCarPreview('preview-ultraman', 'ultraman', '#ecf0f1', 36, 56);
