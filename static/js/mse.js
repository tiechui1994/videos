let verbose = true;
let codecPars = `video/webm;codecs="vp9,opus"`;
let stream_started = false; // is the source_buffer updateend callback active nor not

// create media source instance
const ms = new MediaSource();

// queue for incoming media packets
const queue = [];

let stream_live; // the HTMLMediaElement (i.e. <video> element)
let ws; // websocket
let seeked = false; // have have seeked manually once ..
let cc = 0;
let source_buffer; // source_buffer instance


// consider these callbacks:
// - putPacket : called when websocket receives data
// - loadPacket : called when source_buffer is ready for more data
// Both operate on a common fifo
function putPacket(arr) {
    // receives ArrayBuffer. Called when websocket gets more data
    // first packet ever to arrive: write directly to source_buffer
    // source_buffer ready to accept: write directly to source_buffer
    // otherwise insert it to queue

    const data = arr;
    if (!stream_started) {
        data.arrayBuffer().then((v) => {
            console.info('v', v.byteLength)
            source_buffer.appendBuffer(v);
        });
        stream_started = true;
        cc = cc + 1;
        return;
    }

    queue.push(data); // add to the end
    console.error("queue push:", queue.length);
}


function loadPacket() { // called when source_buffer is ready for more
    if (!source_buffer.updating) { // really, really ready
        if (queue.length > 0) {
            console.log("queue pop:", queue.length);

            const length = queue.length > 20 ? 20 : queue.length;
            const blob = new Blob(queue.splice(0, length), {type: "video/webm; codecs=vp9"});
            blob.arrayBuffer().then((v) => {
                source_buffer.appendBuffer(v);
            });
            
            cc = cc + 1;
        } else { // the queue runs empty, so the next packet is fed directly
            stream_started = false;
        }
    }
}


function opened(url) {
    return function () {
        // MediaSource object is ready to go
        // https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/duration
        ms.duration = 100.0;
        source_buffer = ms.addSourceBuffer(codecPars);

        // https://developer.mozilla.org/en-US/docs/Web/API/source_buffer/mode
        const myMode = source_buffer.mode;
        console.log('old mod', myMode);
        // source_buffer.mode = 'sequence';
        source_buffer.mode = 'segments';

        source_buffer.addEventListener("updateend", loadPacket);
        ws = new WebSocket(url);
        ws.onmessage = function (event) {
            putPacket(event.data);
        };
    }

}

function startup(video, url) {
    ms.addEventListener('sourceopen', opened(url), false);
    stream_live = video;
    stream_live.src = window.URL.createObjectURL(ms);
}