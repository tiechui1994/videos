function Visualizer() {
    this.audioContext = null;
    this.source = null; // the audio source
    this.infoUpdateId = null; //to store the setTimeout ID and clear the interval
    this.animationId = null;
    this.status = 0; //flag for sound is playing 1 or stopped 0
    this.forceStop = false;
    this.allCapsReachBottom = false;


    this.canvas = document.querySelector('canvas')
    this.info = document.querySelector('.info')
}

Visualizer.prototype = {
    init: function () {
        this._prepareAPI();
    },

    _prepareAPI: function () {
        // fix browser vendor for AudioContext and requestAnimationFrame
        window.AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext || window.msAudioContext;
        window.requestAnimationFrame = window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame || window.msRequestAnimationFrame;
        window.cancelAnimationFrame = window.cancelAnimationFrame || window.webkitCancelAnimationFrame || window.mozCancelAnimationFrame || window.msCancelAnimationFrame;
        try {
            this.audioContext = new AudioContext();
            this.audioContext.onstatechange = (ev) => {
                console.log('[onstatechange]', ev)
            }
        } catch (e) {
            this._updateInfo('!Your browser does not support AudioContext', false);
            console.log(e);
        }
    },

    start: function (stream) {
        this._updateInfo('Decode succussfully,start the visualizer', true);
        const ctx = this.audioContext;
        this._visualize(ctx, stream);
    },

    _visualize: function (audioContext, stream) {
        let audioSourceNode;
        const analyser = audioContext.createAnalyser();
        switch (stream.constructor.name) {
            case "MediaStream":
                audioSourceNode = audioContext.createMediaStreamSource(stream)
                break
            case "HTMLMediaElement":
                audioSourceNode = audioContext.createMediaElementSource(stream)
                    .createMediaStreamDestination()
                break
        }


        let that = this;

        audioContext.resume().then(() => {
            console.log('state changed .... ', audioContext.state)
        })

        // analyser.fftSize = 512
        // analyser.minDecibels = -100
        // analyser.maxDecibels = 0
        // analyser.smoothingTimeConstant = .3
        // connect the source to the analyser
        audioSourceNode.connect(analyser);

        //stop the previous sound if any
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
        }
        if (this.source !== null) {
            this.source.stop();
        }
        this.status = 1;
        this.source = stream;

        stream.onended = function () {
            that._audioEnd(that);
        };
        this._updateInfo('Playing', false);
        this._drawSpectrum(analyser);
    },

    _drawSpectrum: function (analyser) {
        let that = this;
        const cwidth = that.canvas.width,
            cheight = that.canvas.height - 2,
            meterWidth = 6, //width of the meters in the spectrum
            gap = 1, // gap between meters
            capHeight = 2,
            capStyle = '#fff',
            meterNum = cwidth / (meterWidth + gap), // count of the meters
            capYPositionArray = []; ////store the vertical position of hte caps for the preivous frame

        const ctx = that.canvas.getContext('2d'),
            gradient = ctx.createLinearGradient(0, 0, 0, 300);

        gradient.addColorStop(1, '#0f0');
        gradient.addColorStop(0.4, '#ff0');
        gradient.addColorStop(0, '#f00');

        const drawMeter = () => {
            const array = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(array);
            if (that.status === 0) {
                // fix when some sounds end the value still not back to zero
                for (let i = array.length - 1; i >= 0; i--) {
                    array[i] = 0;
                }
                that.allCapsReachBottom = true;
                for (let i = capYPositionArray.length - 1; i >= 0; i--) {
                    that.allCapsReachBottom = that.allCapsReachBottom && (capYPositionArray[i] === 0);
                }

                if (that.allCapsReachBottom) {
                    //since the sound is stoped and animation finished, stop the requestAnimation to prevent potential memory leak,THIS IS VERY IMPORTANT!
                    cancelAnimationFrame(that.animationId);
                    return
                }
            }

            // sample limited data from the total array
            const step = Math.round(array.length / meterNum);
            ctx.clearRect(0, 0, cwidth, cheight);
            for (let i = 0; i < meterNum; i++) {
                // let value = array[i * step];
                // let value = array[i * step + Math.round(Math.random() * step)]
                let count = 0;
                for (let k = 0; k < step; k++) {
                    count += array[k + i * step]
                }
                let value = Math.round(count / step)

                if (capYPositionArray.length < Math.round(meterNum)) {
                    capYPositionArray.push(value);
                }

                ctx.fillStyle = capStyle;
                // draw the cap, with transition effect
                if (value < capYPositionArray[i]) {
                    ctx.fillRect(i * (meterWidth + gap), cheight - (--capYPositionArray[i]), meterWidth, capHeight);
                } else {
                    ctx.fillRect(i * (meterWidth + gap), cheight - value, meterWidth, capHeight);
                    capYPositionArray[i] = value;
                }
                ctx.fillStyle = gradient; //set the filllStyle to gradient for a better look
                ctx.fillRect(i * (meterWidth + gap) /*meterWidth+gap*/, cheight - value + capHeight, meterWidth, cheight); //the meter
            }
            that.animationId = requestAnimationFrame(drawMeter);
        }
        this.animationId = requestAnimationFrame(drawMeter);
    },

    _audioEnd: function (instance) {
        if (this.forceStop) {
            this.forceStop = false;
            this.status = 1;
            return
        }
        this.status = 0;
        document.getElementById('info').innerHTML = 'HTML5 Audio API showcase';
    },

    _updateInfo: function (text, processing) {
        let dots = '...',
            i = 0,
            that = this;
        that.info.innerHTML = text + dots.substring(0, i++);
        if (that.infoUpdateId !== null) {
            clearTimeout(that.infoUpdateId);
        }
        if (processing) {
            // animate dots at the end of the info text
            const animateDot = () => {
                if (i > 3) {
                    i = 0
                }
                that.info.innerHTML = text + dots.substring(0, i++);
                that.infoUpdateId = setTimeout(animateDot, 250);
            }
            that.infoUpdateId = setTimeout(animateDot, 250);
        }
    }
}