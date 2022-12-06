function WebsocketMediaSource(codes) {
    this.verbose = true;
    this.codecs = codes;

    // MediaSource instance
    this.mediaSource = new MediaSource();
    // SourceBuffer instance
    this.sourceBuffer = null;

    this.queue = [];
    this.videoStarted = false; // the SourceBuffer updateend callback active nor not
    this.count = 0;
    this.element = null;
}

WebsocketMediaSource.prototype = {
    init: function (element) {
        this.mediaSource.onsourceopen = () => {
            this.onSourceopen()
        }
        this.mediaSource.onsourceclose = (ev) => {
            this.error('[onsourceclose]', this.mediaSource.readyState)
        }
        this.mediaSource.onsourceended = (ev) => {
            this.error('[onsourceended]', this.mediaSource.readyState)
        }

        element.src = window.URL.createObjectURL(this.mediaSource);
        element.controls = true;
        element.autoplay = true;
        element.muted = false;
    },

    onSourceopen: function () {
        this.log('[onSourceopen]', MediaSource.isTypeSupported(this.codecs))
        // https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/duration
        // this.mediaSource.duration = 10000000.0;
        // init SourceBuffer
        this.sourceBuffer = this.mediaSource.addSourceBuffer(this.codecs);
        this.sourceBuffer.onerror = () => {
            console.warn('[onerror]', this.mediaSource.readyState)
        }
        this.sourceBuffer.onabort = () => {
            console.warn('[onabort]', this.mediaSource.readyState)
        }
        this.sourceBuffer.onupdateend = () => {
            this.loadPacket()
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/source_buffer/mode
        this.log('origin mode', this.sourceBuffer.mode);
        // this.sourceBuffer.mode = 'sequence';
        this.sourceBuffer.mode = 'segments';
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
            switch (data.constructor.name) {
                case "ArrayBufferView":
                case "ArrayBuffer":
                    this.sourceBuffer.appendBuffer(data)
                    break
                case 'Blob':
                    data.arrayBuffer().then((v) => {
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
        if (!this.sourceBuffer.updating) {
            this.loadPacket()
        }
    },

    loadPacket: function () {
        this.error('[loadPacket]')
        // called when source_buffer is ready for more
        // really ready
        if (!this.sourceBuffer.updating) {
            if (this.queue.length > 0) {
                this.log("queue pop, current len:", this.queue.length);
                const length = this.queue.length > 20 ? 20 : this.queue.length;
                const blob = new Blob(this.queue.splice(0, length), {type: this.codecs});
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
        if (this.verbose) {
            console.info(...args)
        }
    },

    error: function (...args) {
        if (this.verbose) {
            console.error(...args)
        }
    }
};
