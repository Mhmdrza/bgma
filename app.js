// 48 cities
        const dataSet = [
          [6734, 1453],
          [2233, 10],
          [5530, 1424],
          [401, 841],
          [3082, 1644],
          [7608, 4458],
          [7573, 3716],
          [7265, 1268],
          [6898, 1885],
          [1112, 2049],
          [5468, 2606],
          [5989, 2873],
          [4706, 2674],
          [4612, 2035],
          [6347, 2683],
          [6107, 669],
          [7611, 5184],
          [7462, 3590],
          [7732, 4723],
          [5900, 3561],
          [4483, 3369],
          [6101, 1110],
          [5199, 2182],
          [1633, 2809],
          [4307, 2322],
          [675, 1006],
          [7555, 4819],
          [7541, 3981],
          [3177, 756],
          [7352, 4506],
          [7545, 2801],
          [3245, 3305],
          [6426, 3173],
          [4608, 1198],
          [23, 2216],
          [7248, 3779],
          [7762, 4595],
          [7392, 2244],
          [3484, 2829],
          [6271, 2135],
          [4985, 140],
          [1916, 1569],
          [7280, 4899],
          [7509, 3239],
          [10, 2676],
          [6807, 2993],
          [5185, 3258],
          [3023, 1942],
        ];
        const solutionPathOrder = [
          1,
          8,
          38,
          31,
          44,
          18,
          7,
          28,
          6,
          37,
          19,
          27,
          17,
          43,
          30,
          36,
          46,
          33,
          20,
          47,
          21,
          32,
          39,
          48,
          5,
          42,
          24,
          10,
          45,
          35,
          4,
          26,
          2,
          29,
          34,
          41,
          16,
          22,
          3,
          23,
          14,
          25,
          13,
          11,
          12,
          15,
          40,
          9,
          1,
        ].map((el) => el - 1);
let onlyOnce = false;
        const defaultPixelColor = { r: 40, b: 40, g: 40 };
        const scaleFactor = 40;
        const ctx = chart.getContext("2d");
        ctx.translate(0.5, 0.5);
        // utils to work with canvas
        function setPixelAt(x, y, color) {
          const { r, g, b } = color || defaultPixelColor;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x / scaleFactor, y / scaleFactor, 2, 2);
        }
        function distanceCalculator (src, dest) {
          const [srcX, srcY] = src;
          const [destX, destY] = dest;
          return Math.sqrt(((destX - srcX)**2) + ((destY - srcY)**2));
        }
        function drawCircle (point, radius) {
          ctx.beginPath();
          ctx.strokeStyle = 'blue'
          ctx.arc(point[0]/scaleFactor, point[1]/scaleFactor, radius/scaleFactor, 0, 2 * Math.PI);
          ctx.stroke();
        }
        function drawLine (start, end) {
          ctx.beginPath();
          ctx.strokeStyle = 'grey'
          ctx.moveTo(start[0]/scaleFactor, start[1]/scaleFactor);
          ctx.lineTo(end[0]/scaleFactor, end[1]/scaleFactor);
          ctx.stroke();
        }
        (function drawSolution () {
          let solutionPaths = [], counter = 0, endCount = solutionPathOrder.length;
          solutionPathOrder.reduce( (prevCityIndex, cityIndex) => {
            solutionPaths.push([dataSet[prevCityIndex], dataSet[cityIndex]]);
            return cityIndex;
          }, 0);
          ctx.beginPath();
          function itrate() {
            if (counter < endCount) {
                drawLine(solutionPaths[counter][0], solutionPaths[counter][1]);
                if( this.id !== 'next' ) requestAnimationFrame(itrate)
              counter += 1;
            }else {
              counter = 0;
            }
          }
          solush.onclick = itrate;
          next.onclick = function () {
            ctx.beginPath()
            itrate.call(this)
          };
        })()
        function reset() {
          ctx.beginPath()
          ctx.fillStyle = `rgb(255,255,255)`;
          ctx.fillRect(0, 0, chart.width, chart.height);
          dataSet.forEach((pointXY) =>
            setPixelAt(pointXY[0], pointXY[1])
          );
          const middlePointX = dataSet.reduce((acc, el) => -(-el[0]-acc), 0)/dataSet.length;
          const middlePointY = dataSet.reduce((acc, el) => -(-el[1]-acc), 0)/dataSet.length;
          setPixelAt(middlePointX, middlePointY, {r:255, g: 10, b: 10});
          ctx.stroke();
        }
reset();
        //midlle point
        const middlePointX = dataSet.reduce((acc, el) => -(-el[0]-acc), 0)/dataSet.length;
        const middlePointY = dataSet.reduce((acc, el) => -(-el[1]-acc), 0)/dataSet.length;
        setPixelAt(middlePointX, middlePointY, {r:255, g: 10, b: 10});

        let eachNodeDistanceFromMiddle = dataSet.reduce((acc, point) => {
          // ctx.moveTo(point[0]/scaleFactor, point[1]/scaleFactor);
          // ctx.lineTo(middlePointX/scaleFactor, middlePointY/scaleFactor);
          return acc + distanceCalculator([middlePointX, middlePointY], point);
        }, 0);
        circl.onclick = () => drawCircle([middlePointX, middlePointY], eachNodeDistanceFromMiddle/dataSet.length);

