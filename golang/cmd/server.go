package main

import (
	"net/http"

	"github.com/video/ws"
)

func main() {
	websocket := ws.NewWebSocketServer()
	websocket.Initializer(&ws.WebSocketConfig{
		MessageType: ws.BinaryMessage,
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(writer http.ResponseWriter, request *http.Request) {
		websocket.Upgrade(writer, request, http.Header{})
	})
	mux.HandleFunc("/file", func(writer http.ResponseWriter, request *http.Request) {
		websocket.ServerFile(writer, request)
	})

	server := http.Server{
		Addr:    ":8088",
		Handler: mux,
	}

	server.ListenAndServe()
}
