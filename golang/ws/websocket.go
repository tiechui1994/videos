package ws

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ion-log"
)

type WebSocketServer struct {
	WebSocketConfig
	upgrader *websocket.Upgrader

	broadcast  chan *broadcastData
	register   chan *Conn
	unregister chan *Conn
	nodes      sync.Map
	fd         *os.File
}

type broadcastData struct {
	data []byte
}

func NewWebSocketServer() *WebSocketServer {
	instance := &WebSocketServer{
		upgrader: &websocket.Upgrader{
			HandshakeTimeout: time.Second,
		},
		broadcast:  make(chan *broadcastData),
		register:   make(chan *Conn),
		unregister: make(chan *Conn),
		nodes:      sync.Map{},
	}

	return instance
}

func (w *WebSocketServer) Upgrade(writer http.ResponseWriter, request *http.Request, header http.Header) {
	var err error
	defer func() {
		if err != nil {
			io.WriteString(writer, err.Error())
		}
	}()

	var raw *websocket.Conn
	raw, err = w.upgrader.Upgrade(writer, request, header)
	if err != nil {
		return
	}

	master := request.URL.Query().Get("master")
	if master == "" {
		err = fmt.Errorf("invalid master")
		return
	}
	slave := request.URL.Query().Get("slave")
	if slave == "" {
		err = fmt.Errorf("invalid slave")
		return
	}

	if master == slave {
		log.Infof("add new master: %v", master)
		node := newNode(raw, w.PingPeriod, uint(w.PingTimeout), w.MessageType)
		w.nodes.Store(master, node)
		return
	}

	if val, ok := w.nodes.Load(master); ok {
		log.Infof("add new slave: %v", slave)
		val.(Node).AddSlave(raw)
		return
	}

	err = fmt.Errorf("invalid params")
}

const (
	chunk = 64*1024 - 1
)

func (w *WebSocketServer) ServerFile(writer http.ResponseWriter, request *http.Request) {
	var err error
	defer func() {
		if err != nil {
			io.WriteString(writer, err.Error())
		}
	}()

	if request.Method != http.MethodGet {
		return
	}

	master := request.URL.Query().Get("master")
	if master == "" {
		err = fmt.Errorf("invalid master")
		return
	}
	val, ok := w.nodes.Load(master)
	if !ok {
		err = fmt.Errorf("invalid master")
		return
	}
	session := val.(*Session)
	filename := fmt.Sprintf("/tmp/master_%v.webm", strings.ReplaceAll(session.master.RemoteAddr(), ":", "_"))

	fd, _ := os.OpenFile(filename, os.O_RDONLY, 0666)
	defer func() {
		fd.Close()
	}()

	header := writer.Header()
	header.Set("Access-Control-Allow-Credentials", "true")
	header.Set("Access-Control-Allow-Headers", "Content-Type, Accept, Range")
	header.Set("Access-Control-Allow-Method", "GET, POST, OPTIONS")
	header.Set("Access-Control-Allow-Origin", "*")
	header.Set("Connection", "keep-alive")
	header.Set("Cache-Control","no-cache")

	ranges := request.Header.Get("range")
	parts := strings.Split(strings.ReplaceAll(ranges, "bytes=", ""), "-")
	var start, end int64
	if len(parts) == 2 {
		start, _ = strconv.ParseInt(parts[0], 10, 64)
		end, _ = strconv.ParseInt(parts[1], 10, 64)
	}
	if end == 0 {
		end = start + chunk
	}

	data := make([]byte, end-start+1)
	n, err := fd.ReadAt(data, start)
	log.Infof("err: %v, %v", err, n)
	if n != len(data) {
		end = start + int64(n) - 1
	}

	stat, _ := fd.Stat()
	log.Infof("file %v, size %v", filename, stat.Size())
	writer.Header().Set("Content-Range", fmt.Sprintf("bytes %v-%v/%v", start, end, stat.Size()))
	writer.Header().Set("Accept-Ranges", "bytes")
	writer.Header().Set("Content-Type", "video/mp4")
	writer.Header().Set("Content-Length", fmt.Sprintf("%v", end-start+1))
	writer.WriteHeader(206)

	writer.Write(data[:n])
}

func (w *WebSocketServer) Initializer(c *WebSocketConfig) error {
	if c == nil {
		return fmt.Errorf("config cna not be nil")
	}

	config := *c
	config.SetDefault()
	err := config.Valid()
	if err != nil {
		return err
	}

	w.WebSocketConfig = config
	w.upgrader.HandshakeTimeout = config.HandshakeTimeout
	w.upgrader.ReadBufferSize = config.ReadBufferSize
	w.upgrader.WriteBufferSize = config.WriteBufferSize
	w.upgrader.CheckOrigin = func(r *http.Request) bool {
		return checkOrigin(r.Header.Get("origin"), w.AllowOrigins)
	}

	return nil
}

func checkOrigin(origin string, allowOrigins []string) bool {
	if len(allowOrigins) == 1 && allowOrigins[0] == "*" {
		return true
	}
	for _, o := range allowOrigins {
		if o == origin {
			return true
		}
	}
	return false
}
