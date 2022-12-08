const DeviceKind = {
    AUDIOINPUT: 'audioinput',
    AUDIOOUTPUT: 'audiooutput',
    VIDEOINPUT: 'videoinput'
};

const codecs = 'video/mp4; codecs="avc1"';

function log(...args) {
    console.log(...args)
}

async function getDevices(kind) {
    const device = [];
    await navigator.mediaDevices.enumerateDevices().then(function (mediaDevices) {
        mediaDevices.forEach((v) => {
            const label = v.label.toLocaleLowerCase();
            if (v.kind === kind && !(label.includes('virtual') || label.includes('虚拟'))) {
                log(v);
                device.push(v);
            }
        });
    }).catch(function (err) {
        log(err.name + ': ' + err.message);
    });
    return device;
}

function captureUserMedia(kind, success_callback) {
    getDevices().then((device) => {
        if (device.length > 0) {
            const session = {
                audio: {
                    groupId: device[0].groupId,
                },
                video: {
                    width: 3840,
                    height: 2160,
                    frameRate: 60
                }
            };
            navigator.mediaDevices.getUserMedia(session).then(success_callback).catch((error) => {
                alert('Unable to capture your camera. Please check console logs.');
                console.error(error);
            });
        }
    });
}

function captureDisplayMedia(kind, success_callback) {
    getDevices(kind).then((device) => {
        if (!device.length) {
            alert('没有合适的输入设备, 请检查后再试....');
            return
        }

        const videoConstraints = {
            video: {
                width: 2560,
                height: 1440,
                frameRate: 30
            }
        };
        console.log('video', videoConstraints)
        navigator.mediaDevices.getDisplayMedia(videoConstraints).then((videoStream) => {
            const [videoTrack] = videoStream.getVideoTracks()
            const audioConstraints = {
                audio: {
                    groupId: device[0].groupId,
                    autoGainControl: true, // 自动增益
                    echoCancellation: true, // 回声消除
                    noiseSuppression: true, // 噪音抑制
                    chromeMediaSource: 'screen'
                },
            };
            console.log('audio', audioConstraints)
            navigator.mediaDevices.getUserMedia(audioConstraints).then((audioStream) => {
                const [audioTrack] = audioStream.getAudioTracks()
                console.log(videoTrack, audioTrack)
                const stream = new MediaStream([videoTrack, audioTrack])
                videoTrack.onended = () => {
                    videoStream.stop()
                    audioStream.stop()
                    stream.stop()
                    log("videoTrack and audioTrack stop")
                    log("videoTrack Stop ..............")
                }
                audioTrack.onended = () => {
                    log("audioTrack Stop ..............")
                }
                success_callback(stream)
            })
        }).catch((err) => {
            alert('无法获取到共享桌面, 请检查后再试....');
            console.error(err);
        });
    })
}


function Transport(url) {
    this.socket = null
    this.closed = false;
    this.connected = false;
    this.url = url;
}

Transport.prototype = {
    connect: function (onmessage) {
        console.log('connect:', this.url)
        this.socket = new WebSocket(this.url)
        this.socket.onopen = () => {
            this.connected = true;
            console.log("[onopen], connected websocket");
        };

        if (onmessage) {
            this.socket.onmessage = onmessage
        }

        this.socket.onclose = (ev) => {
            console.log('[onclose]', ev)
            if (this.closed) {
                return
            }

            this.connected = false
            this.connect(onmessage)
        }

        this.socket.onerror = (ev) => {
            console.log('[onerror]', ev)
        }
    },

    send: function (data) {
        if (!this.connected) {
            return
        }

        this.socket.send(data)
    },

    close: function () {
        console.log('close ....')
        if (this.closed || !this.connected) {
            this.closed = true
            return
        }

        this.closed = true
        this.socket.close()
    }
};

function Master(url) {
    this.url = url;
    this.recorder = null;
    this.transport = null;
    this.closed = false;
    this.video = document.createElement('video');
    this.stream = null;
    this.Visualizer = null;
}

Master.prototype = {
    onstart: function () {
        this.transport = new Transport(this.url);
        this.transport.connect()

        this.Visualizer = new Visualizer()
        this.Visualizer.init()

        this.video.width = 640;
        this.video.height = 480;

        captureDisplayMedia(DeviceKind.AUDIOOUTPUT, (stream) => {
            this.video.srcObject = stream;
            this.video.controls = true;
            this.video.autoplay = true;
            this.video.muted = true;

            this.stream = stream;

            this.Visualizer.start(stream)

            const queue = [];
            const config = {
                mimeType: codecs, // vp8, vp9, h264, mkv, opus/vorbis
                audioBitsPerSecond: 256 * 8 * 1024,
                videoBitsPerSecond: 256 * 8 * 1024,
                checkForInactiveTracks: true,
                timeSlice: 500, // concatenate intervals based blobs
                ondataavailable: function (data, type) {
                    queue.push(data);
                }
            };

            this.recorder = new MediaStreamRecorder(stream, config);
            this.recorder.record();

            log('start ..........');
            const task = setInterval(() => {
                if (queue.length === 0) {
                    if (this.closed) {
                        log('closed .......')
                        clearInterval(task)
                    }
                    return
                }

                const length = queue.length > 30 ? 30 : queue.length;
                const blob = new Blob(queue.splice(0, length), {type: codecs});
                console.info('send v', blob.size)
                this.transport.send.call(this.transport, blob)
            }, 1000);
        });
    },

    onpause: function () {
        if (this.recorder) {
            this.recorder.pause()
        }
    },
    onresume: function () {
        if (this.recorder) {
            this.recorder.resume()
        }
    },
    onstop: function () {
        if (this.recorder) {
            this.recorder.stop((blob) => {
                this.video.srcObject = null;
                this.video.src = URL.createObjectURL(blob);
                this.video.controls = true;
                this.video.autoplay = true;
                this.video.muted = false;
            });

            this.closed = true
            if (this.stream) {
                this.stream.stop()
            }

            this.transport.close()
        }
    }
};

function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}


function onMaster(url) {
    const master = new Master(url);
    master.onstart()

    const div = document.createElement('div');

    const controlBtn = document.createElement('button');
    controlBtn.innerHTML = '暂停录制';
    controlBtn.className = 'btn btn-success btn-lg button';
    controlBtn.setAttribute('data', 'resume')
    controlBtn.onclick = () => {
        switch (controlBtn.getAttribute('data')) {
            case 'resume':
                log('onpause ......')
                controlBtn.innerHTML = '恢复录制';
                controlBtn.setAttribute('data', 'pause')
                master.onpause()
                break
            case 'pause':
                log('onresume ......')
                controlBtn.innerHTML = '暂停录制';
                controlBtn.setAttribute('data', 'resume')
                master.onresume()
                break

        }
    }

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '结束';
    closeBtn.className = 'btn btn-success btn-lg button';
    closeBtn.onclick = () => {
        master.onstop()
    }

    div.appendChild(controlBtn)
    div.appendChild(closeBtn)

    const container = document.querySelector('#videos');
    container.appendChild(master.video);
    container.appendChild(div)
}

function onSlave(url) {
    const container = document.querySelector('#videos');

    const video = document.createElement('video')
    video.controls = true;
    video.autoplay = true;
    video.width = 640;
    video.height = 320;

    container.appendChild(video)

    const mediaSource = new WebsocketMediaSource(codecs);
    mediaSource.init(video)
    const transport = new Transport(url)
    transport.connect((event) => {
        console.info('recv v', event.data.size)
        mediaSource.putPacket.call(mediaSource, event.data)
    })
}


async function onVideo() {
    const mediaSource = new MediaSource();

    const video = document.createElement("video");
    video.width = 320;
    video.height = 240;
    video.autoplay = true;
    video.controls = true;

    document.querySelector('#videos').appendChild(video)

    const urls = ["https://nickdesaulniers.github.io/netfix/demo/frag_bunny.mp4",
        "https://raw.githubusercontent.com/w3c/web-platform-tests/master/media-source/mp4/test.mp4",
        "https://raw.githubusercontent.com/w3c/web-platform-tests/master/media-source/mp4/test.mp4",
        "https://nickdesaulniers.github.io/netfix/demo/frag_bunny.mp4"];

    const request = url => fetch(url).then(response => response.arrayBuffer());

    // `urls.reverse()` stops at `.currentTime` : `9`
    const files = await Promise.all(urls.map(request));

    /*
     `.webm` files 'SourceBuffer': This SourceBuffer has been removed from the parent media
     Uncaught DOMException: Failed to execute 'appendBuffer' on source.
     Uncaught DOMException: Failed to set the 'timestampOffset' property on 'SourceBuffer': This SourceBuffer has been removed from the parent media source.
    */
    // const mimeCodec = "video/webm; codecs=opus";
    // https://stackoverflow.com/questions/14108536/how-do-i-append-two-video-files-data-to-a-source-buffer-using-media-source-api/
    const mimeCodec = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';

    const media = await Promise.all(files.map(file => {
        return new Promise(resolve => {
            let media = document.createElement("video");
            let blobURL = URL.createObjectURL(new Blob([file]));
            media.onloadedmetadata = async e => {
                resolve({
                    mediaDuration: media.duration,
                    mediaBuffer: file
                })
            }
            media.src = blobURL;
        })
    }));

    console.log(media);

    mediaSource.addEventListener("sourceopen", sourceOpen);

    video.src = URL.createObjectURL(mediaSource);

    async function sourceOpen(event) {
        if (MediaSource.isTypeSupported(mimeCodec)) {
            const sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);

            for (let chunk of media) {
                await new Promise(resolve => {
                    sourceBuffer.appendBuffer(chunk.mediaBuffer);
                    sourceBuffer.onupdateend = e => {
                        sourceBuffer.onupdateend = null;
                        sourceBuffer.timestampOffset += chunk.mediaDuration;
                        console.log(mediaSource.duration);
                        resolve()
                    }
                })

            }

            mediaSource.endOfStream();

        } else {
            console.warn(mimeCodec + " not supported");
        }
    }
}

function test() {
    const types = [
        'video/webm',
        'audio/webm',
        'video/mpeg',
        'video/mp4',
        'video/webm;codecs="vp8"',
        'video/webm;codecs="vp9"',
        'video/webm;codecs="daala"',
        'video/webm;codecs="h264"',
        'video/webm;codecs="H264"',
        'video/webm;codecs="avc1"',
        'video/x-matroska;codecs="avc1"',
        'audio/webm;codecs="opus"',
        'video/mp4; codecs="avc1.424028, mp4a.40.2"'
    ];

    for (const type of types) {
        console.log(
            `Is ${type} supported? ${MediaRecorder.isTypeSupported(type) ? "Yes" : "No"}`
        );
    }
}

(() => {
    test()
    const url = "wss://" + window.location.host + '/api/ws';
    let master;


    if (window.location.search && window.location.search.length > 7) {
        const tokens = window.location.search.substring(1).split('&')
        tokens.forEach((item) => {
            if (item.includes('master=')) {
                master = item
            }
        })
    }

    if (!master) {
        master = new Date().valueOf()
        onMaster(url + `?master=${master}&slave=${master}`)
    } else {
        const slave = new Date().valueOf()
        onSlave(url + `?${master}&slave=${slave}`)
    }

    // master = new Date().valueOf()
    // onMaster(url + `?master=${master}&slave=${master}`)
    // sleep(2500).then(() => {
    //     const slave = new Date().valueOf()
    //     onSlave(url + `?master=${master}&slave=${slave}`)
    // })
})();

