function WebsocketMediaSource() {
    this.verbose = true;
    this.codecs = 'video/webm;codecs="vp9,opus"';

    // MediaSource instance
    this.mediaSource = new MediaSource();
    // SourceBuffer instance
    this.sourceBuffer = null;

    this.queue = [];
    this.videoStarted = false; // the SourceBuffer updateend callback active nor not
    this.count = 0;
}

WebsocketMediaSource.prototype = {
    init: function () {
        // MediaSource object is ready to go
        // this.mediaSource.onsourceopen = this.onSourceopen.bind(this)
        this.mediaSource.addEventListener('sourceopen', this.onSourceopen.bind(this), false)
        this.mediaSource.onsourceclose = (ev) => {
            this.log('[onsourceclose]', ev)
        }
        this.mediaSource.onsourceended = (ev) => {
            this.log('[onsourceended]', ev)
        }

        return window.URL.createObjectURL(this.mediaSource);
    },

    onSourceopen: function () {
        this.log('[onSourceopen]', this)
        // https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/duration
        this.mediaSource.duration = 100.0;
        // init SourceBuffer
        this.sourceBuffer = this.mediaSource.addSourceBuffer(this.codecs);

        // https://developer.mozilla.org/en-US/docs/Web/API/source_buffer/mode
        this.log('origin mode', this.sourceBuffer.mode);
        // source_buffer.mode = 'sequence';
        this.sourceBuffer.mode = 'segments';
        this.sourceBuffer.onupdateend = this.loadPacket.bind(this)
    },

    // consider these callbacks:
    // - putPacket : called when websocket receives data
    // - loadPacket : called when sourceBuffer is ready for more data
    // Both operate on a common FIFO
    putPacket: function (arr) {
        // receives ArrayBuffer. Called when websocket gets more data
        // first packet ever to arrive: write directly to sourceBuffer
        // sourceBuffer ready to accept: write directly to sourceBuffer
        // otherwise insert it to queue
        const data = arr;
        if (!this.videoStarted) {
            console.info(data)
            switch (data.constructor.name) {
                case "ArrayBufferView":
                case "ArrayBuffer":
                    this.sourceBuffer.appendBuffer(data)
                    break
                default:
                    data.arrayBuffer().then((v) => {
                        this.log('len', v.byteLength)
                        this.sourceBuffer.appendBuffer(v)
                    })
                    break
            }


            this.videoStarted = true;
            this.count = this.count + 1;
            return;
        }

        this.queue.push(data); // add to the end
        this.log("queue push, current len:", this.queue.length);
    },

    loadPacket: function () {
        // called when source_buffer is ready for more
        // really ready
        if (!this.sourceBuffer.updating) {
            if (this.queue.length > 0) {
                this.log("queue pop, current len:", this.queue.length);
                const length = this.queue.length > 20 ? 20 : this.queue.length;
                const blob = new Blob(this.queue.splice(0, length), {type: "video/webm; codecs=vp9"});
                blob.arrayBuffer().then((v) => {
                    this.sourceBuffer.appendBuffer(v)
                });
                this.count = this.count + 1;
            } else {
                // the queue runs empty, so the next packet is fed directly
                this.videoStarted = false;
            }
        }
    },

    log: function (...args) {
        if (!this.verbose) {
            console.info(...args)
        }
    }
}
