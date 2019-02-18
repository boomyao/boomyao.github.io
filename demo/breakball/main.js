const BreakBall = function () {
  this.ballRadius = 60
  this.chipLen = 1000
  this.chips = []
  this.colors = []

  const colorData = [{
      occur: 5,
      alpha: 0.8,
      style: 'hsl(178, 100%, 60%)'
    },
    {
      occur: 10,
      alpha: 0.8,
      style: '#222'
    },
    {
      occur: 15,
      alpha: 0.8,
      style: '#555'
    }
  ];

  colorData.forEach(color => {
    for (let i = 0; i < color.occur; i++) {
      this.colors.push(color);
    }
  });

  for (let i = 0; i < this.chipLen; i++) {
    const chip = {
      color: this.rdmColor(),
      size: this.rdmSize() * (i / this.chipLen),
      vertexDeg: this.rdmVertexDeg(),
      pos2Ball: this.rdmPos2Ball(),
      rotate: this.rdmRotateDeg()
    }
    this.chips.push(chip);
  }

  this.mouseEngine = buyAMouseEngine('mousemove')
  this.mouseEngine.config((e) => {
    if (isTouchable() && e.touches) {
      this.mouseEngine.pos[0] = e.touches[0].clientX;
      this.mouseEngine.pos[1] = e.touches[0].clientY;
      return;
    }
    this.mouseEngine.pos[0] = e.clientX;
    this.mouseEngine.pos[1] = e.clientY;
  })
  this.mouseEngine.pos[0] = window.innerWidth / 2;
  this.mouseEngine.pos[1] = window.innerHeight / 2;

  this.mouseStack = {
    data: new Array(100).fill(null).map(() => [...this.mouseEngine.pos]),
    factor: 0
  }
}

BreakBall.prototype.rdmVertexDeg = function () {
  return [(0 / 3 + Math.random() / 1.5) * Math.PI,
    (2 / 3 + Math.random() / 1.5) * Math.PI,
    (4 / 3 + Math.random() / 1.5) * Math.PI
  ]
}

BreakBall.prototype.rdmSize = function () {
  return Math.random() * 20
}

BreakBall.prototype.rdmPos2Ball = function () {
  return {
    dist: Math.random() * this.ballRadius,
    deg: Math.random() * Math.PI * 2,
    selfDeg: Math.random() * Math.PI * 2
  }
}

BreakBall.prototype.rdmRotateDeg = function () {
  return {
    perDeg: Math.PI * 2 * (1 - 2 * Math.random()) * 0.008,
    perSelfDeg: Math.PI * 2 * (1 - 2 * Math.random()) * 0.01
  }
}

BreakBall.prototype.rdmColor = function () {
  return this.colors[this.colors.length * Math.random() | 0];
}

BreakBall.prototype.getMouseStack = function (pos) {
  const stackLen = this.mouseStack.data.length
  return this.mouseStack.data[(stackLen + (this.mouseStack.factor - pos * stackLen) | 0) % stackLen]
}



function buyAMouseEngine(type) {
  return {
    pos: [0, 0],
    config: function (action) {
      window.addEventListener(type, action);
      if (isTouchable()) {
        window.addEventListener("touchmove", action)
      }
    }
  }
}

function isTouchable() {
  return !!navigator.userAgent.match(/(Android|Mobile)/g)
}

window.onload = function () {
  const breakBall = new BreakBall()

  const darkForest = document.getElementById('darkForest')
  darkForest.width = window.innerWidth
  darkForest.height = window.innerHeight
  const entry = darkForest.getContext('2d')

  const explain = function () {
    entry.clearRect(0, 0, darkForest.width, darkForest.height)

    breakBall.mouseStack.factor++;
    const stack = breakBall.getMouseStack(0)
    stack[0] = breakBall.mouseEngine.pos[0]
    stack[1] = breakBall.mouseEngine.pos[1]

    breakBall.chips.forEach((chip, idx) => {
      entry.beginPath();
      entry.globalAlpha = chip.color.alpha;
      entry.fillStyle = chip.color.style;

      // 计算碎片的坐标
      const order = idx / breakBall.chips.length
      const pos = []
      chip.pos2Ball.deg += chip.rotate.perDeg;
      pos[0] = Math.cos(chip.pos2Ball.deg) * chip.pos2Ball.dist * order;
      pos[1] = Math.sin(chip.pos2Ball.deg) * chip.pos2Ball.dist * order;
      chip.pos2Ball.selfDeg += chip.rotate.perSelfDeg;

      const rdmStack = breakBall.getMouseStack(1 - order)
      const mousePos = []
      mousePos[0] = rdmStack[0]
      mousePos[1] = rdmStack[1]

      entry.moveTo(mousePos[0] + pos[0] + Math.cos(chip.vertexDeg[0] + chip.pos2Ball.selfDeg) * chip.size,
        mousePos[1] + pos[1] + Math.sin(chip.vertexDeg[0] + chip.pos2Ball.selfDeg) * chip.size)

      entry.lineTo(mousePos[0] + pos[0] + Math.cos(chip.vertexDeg[1] + chip.pos2Ball.selfDeg) * chip.size,
        mousePos[1] + pos[1] + Math.sin(chip.vertexDeg[1] + chip.pos2Ball.selfDeg) * chip.size)

      entry.lineTo(mousePos[0] + pos[0] + Math.cos(chip.vertexDeg[2] + chip.pos2Ball.selfDeg) * chip.size,
        mousePos[1] + pos[1] + Math.sin(chip.vertexDeg[2] + chip.pos2Ball.selfDeg) * chip.size)

      entry.closePath();
      entry.fill();
    })

    requestAnimationFrame(explain);
  }

  explain();
}