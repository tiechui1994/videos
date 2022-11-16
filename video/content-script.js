console.info("===================>")

const input = document.querySelector('input');
console.info("input:", input)
console.info("input value:", input.value)

const video = document.querySelector('video');
console.info("video:", video)
console.info('video tracks:', video.captureStream())

