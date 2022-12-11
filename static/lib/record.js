function MediaStreamRecorder(mediaStream, config) {
    if (typeof mediaStream === 'undefined') {
        throw 'First argument "MediaStream" is required.';
    }

    if (typeof MediaRecorder === 'undefined') {
        throw 'Your browser does not support the Media Recorder API. Please try other modules e.g. WhammyRecorder or StereoAudioRecorder.';
    }

    if (!isMediaStreamActive(mediaStream)) {
        throw "mediaStream is not alive"
    }

    this.config = config || {
        bitsPerSecond: 256 * 8 * 1024,
        mimeType: 'video/webm',
        onTimeStamp: null,
        disableLogs: true,
        getNativeBlob: false,
        timeSlice: null,
        initCallback: null,
    };
    this.mediaStream = mediaStream;
    this.mediaRecorder = null;

    this.arrayOfBlobs = [];
    this.allStates = [];
    this.timestamps = [];
    this.blob = null;


    // if any Track within the MediaStream is muted or not enabled at any time,
    // the browser will only record black frames
    // or silence since that is the content produced by the Track
    // so we need to stopRecording as soon as any single track ends.
    if (typeof this.config.checkForInactiveTracks === 'undefined') {
        this.config.checkForInactiveTracks = false; // disable to minimize CPU usage
    }

    this.name = 'MediaStreamRecorder';
}

function isMediaStreamActive(mediaStream) {
    if ('active' in mediaStream) {
        if (!mediaStream.active) {
            return false;
        }
    } else if ('ended' in mediaStream) { // old hack
        if (mediaStream.ended) {
            return false;
        }
    }
    return true;
}

function bytesToSize(bytes) {
    let k = 1000;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) {
        return '0 Bytes';
    }
    let i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toPrecision(3) + ' ' + sizes[i];
}

MediaStreamRecorder.prototype = {
    updateTimeStamp: function () {
        this.timestamps.push(new Date().getTime());
        if (typeof this.config.onTimeStamp === 'function') {
            this.config.onTimeStamp(this.timestamps[this.timestamps.length - 1], this.timestamps);
        }
    },

    record: function () {
        // set defaults
        this.blob = null;
        this.clearRecordedData();
        this.timestamps = [];
        this.allStates = [];
        this.arrayOfBlobs = [];

        if (!this.config.disableLogs) {
            console.log('Passing following config over MediaRecorder API.', this.config);
        }

        if (this.mediaRecorder) {
            this.mediaRecorder = null;
        }

        if (typeof MediaRecorder.isTypeSupported === 'function' && this.config.mimeType) {
            if (!MediaRecorder.isTypeSupported(this.config.mimeType)) {
                if (!this.config.disableLogs) {
                    console.warn('MediaRecorder API seems unable to record mimeType:', this.config.mimeType);
                }

                this.config.mimeType = this.config.type === 'audio' ? 'audio/webm' : 'video/webm';
            }
        }

        // using MediaRecorder API here
        try {
            this.mediaRecorder = new MediaRecorder(this.mediaStream, this.config);
        } catch (e) {
            // chrome-based fallback
            this.mediaRecorder = new MediaRecorder(this.mediaStream);
        }

        // old hack?
        if (this.config.mimeType &&
            !MediaRecorder.isTypeSupported &&
            'canRecordMimeType' in this.mediaRecorder &&
            this.mediaRecorder.canRecordMimeType(this.config.mimeType) === false) {
            if (!this.config.disableLogs) {
                console.warn('MediaRecorder API seems unable to record mimeType:', this.config.mimeType);
            }
        }

        // Dispatching OnDataAvailable Handler
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data) {
                this.allStates.push('ondataavailable: ' + bytesToSize(e.data.size));
            }

            // timeSlice
            if (typeof this.config.timeSlice === 'number') {
                if (e.data && e.data.size) {
                    this.arrayOfBlobs.push(e.data);
                    this.updateTimeStamp();

                    if (typeof this.config.ondataavailable === 'function') {
                        this.config.ondataavailable(e.data, e.type);
                    }
                }
                return;
            }

            // onStop
            if (!e.data || !e.data.size || e.data.size < 100 || this.blob) {
                // make sure that stopRecording always getting fired even if there is invalid data
                if (this.recordingCallback) {
                    this.recordingCallback(new Blob([], {
                        type: this.getMimeType(this.config)
                    }));
                    this.recordingCallback = null;
                }
                return;
            }

            this.blob = this.config.getNativeBlob ? e.data : new Blob([e.data], {
                type: this.getMimeType(this.config)
            });
            if (this.recordingCallback) {
                this.recordingCallback(this.blob);
                this.recordingCallback = null;
            }
        };

        this.mediaRecorder.onstart = () => {
            this.allStates.push('started');
        };

        this.mediaRecorder.onpause = () => {
            this.allStates.push('paused');
        };

        this.mediaRecorder.onresume = () => {
            this.allStates.push('resumed');
        };

        this.mediaRecorder.onstop = () => {
            this.allStates.push('stopped');
        };

        this.mediaRecorder.onerror = (error) => {
            if (!error) {
                return
            }

            if (!error.name) {
                error.name = 'UnknownError';
            }

            this.allStates.push('error: ' + error);

            if (!this.config.disableLogs) {
                const name = error.name.toString().toLowerCase();
                // via: https://w3c.github.io/mediacapture-record/MediaRecorder.html#exception-summary
                if (name.indexOf('invalidstate') !== -1) {
                    console.error('The MediaRecorder is not in a state in which the proposed operation is allowed to be executed.', error);
                } else if (name.indexOf('notsupported') !== -1) {
                    console.error('MIME type (', this.config.mimeType, ') is not supported.', error);
                } else if (name.indexOf('security') !== -1) {
                    console.error('MediaRecorder security error', error);
                }

                // older code below
                else if (error.name === 'OutOfMemory') {
                    console.error('The UA has exhaused the available memory. User agents SHOULD provide as much additional information as possible in the message attribute.', error);
                } else if (error.name === 'IllegalStreamModification') {
                    console.error('A modification to the stream has occurred that makes it impossible to continue recording. An example would be the addition of a Track while recording is occurring. User agents SHOULD provide as much additional information as possible in the message attribute.', error);
                } else if (error.name === 'OtherRecordingError') {
                    console.error('Used for an fatal error other than those listed above. User agents SHOULD provide as much additional information as possible in the message attribute.', error);
                } else if (error.name === 'GenericError') {
                    console.error('The UA cannot provide the codec or recording option that has been requested.', error);
                } else {
                    console.error('MediaRecorder Error', error);
                }
            }

            (() => {
                const looper = () => {
                    if (!this.manuallyStopped && this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
                        delete this.config.timeSlice;

                        // 10 minutes, enough?
                        this.mediaRecorder.start(10 * 60 * 1000);
                    }
                }

                setTimeout(looper, 1000);
            })();

            if (this.mediaRecorder.state !== 'inactive' && this.mediaRecorder.state !== 'stopped') {
                this.mediaRecorder.stop();
            }
        };

        if (typeof this.config.timeSlice === 'number') {
            this.updateTimeStamp();
            this.mediaRecorder.start(this.config.timeSlice);
        } else {
            // default is 24 hours; enough? (thanks https://github.com/slidevjs/slidev/pull/488)
            // use config => {timeSlice: 1000} otherwise
            this.mediaRecorder.start(24 * 60 * 60 * 1000);
        }

        if (this.config.initCallback) {
            this.config.initCallback(); // old code
        }
    },

    getArrayOfBlobs: function () {
        return this.arrayOfBlobs;
    },
    getAllStates: function () {
        return this.allStates;
    },

    getState: function () {
        if (!this.mediaRecorder) {
            return 'inactive';
        }

        return this.mediaRecorder.state || 'inactive';
    },

    getMimeType: function (secondObject) {
        if (this.mediaRecorder && this.mediaRecorder.mimeType) {
            return this.mediaRecorder.mimeType;
        }
        return secondObject.mimeType || 'video/webm';
    },

    stop: function (callback) {
        callback = callback || function () {
        };

        this.manuallyStopped = true; // used inside the mediaRecorder.onerror

        if (!this.mediaRecorder) {
            return;
        }

        this.recordingCallback = callback;

        if (this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }

        if (typeof this.config.timeSlice === 'number') {
            setTimeout(() => {
                this.blob = new Blob(this.arrayOfBlobs, {
                    type: this.getMimeType(this.config)
                });

                this.recordingCallback(this.blob);
            }, 100);
        }
    },

    pause: function () {
        if (!this.mediaRecorder) {
            return;
        }

        if (this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.pause();
        }
    },

    resume: function () {
        if (!this.mediaRecorder) {
            return;
        }
        if (this.mediaRecorder.state === 'paused') {
            this.mediaRecorder.resume();
        }
    },

    clearRecordedData: function () {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.stop(this.clearRecordedDataCB.bind(this));
        }

        this.clearRecordedDataCB();
    },

    clearRecordedDataCB: function () {
        this.arrayOfBlobs = [];
        this.mediaRecorder = null;
        this.timestamps = [];
    },
}