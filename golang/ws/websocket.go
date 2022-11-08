package ws

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ion-log"
)

const (
	defaultStackTraceBufLen = 2048
)

// https://docs.microsoft.com/en-us/windows/win32/winsock/windows-sockets-error-codes-2
const (
	WSAEACCESS      = 10013 // An attempt was made to access a socket in a way forbidden by its access permissions
	WSAEWOULDBLOCK  = 10035 // Resource temporarily unavailable.
	WSAEDESTADDRREQ = 10039 // A required address was omitted from an operation on a socket
	WSAEMSGSIZE     = 10040 // A message sent on a datagram socket was larger than the internal message buffer or some other network limit,
	WSAENETDOWN     = 10050 // A socket operation encountered a dead network.
	WSAENETUNREACH  = 10051 // A socket operation was attempted to an unreachable network.
	WSAENETRESET    = 10052 // The connection has been broken due to keep-alive activity detecting a failure while the operation was in progress.
	WSAECONNABORTED = 10053 // An established connection was aborted by the software in your host computer
	WSAECONNRESET   = 10054 // An existing connection was forcibly closed by the remote host.
	WSAESHUTDOWN    = 10058 // Cannot send after socket shutdown.
	WSAETIMEDOUT    = 10060 // A connection attempt failed because the connected party did not properly respond after a period of time
	WSAEHOSTDOWN    = 10064 // Host is down.
	WSAEHOSTUNREACH = 10065 // No route to host.
	WSASYSNOTREADY  = 10091 // Network subsystem is unavailable.
	WSAEDISCON      = 10101 // Graceful shutdown in progress.
)

type WebSocketServer struct {
	WebSocketConfig
	upgrader *websocket.Upgrader

	broadcast  chan *broadcastData
	register   chan *Conn
	unregister chan *Conn
	conns      sync.Map
	connCount  int32
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
		conns:      sync.Map{},
	}

	return instance
}

func (w *WebSocketServer) Upgrade(writer http.ResponseWriter, request *http.Request, header http.Header) (err error) {
	defer func() {
		if err != nil {
			atomic.AddInt32(&w.connCount, -1)
		}
	}()

	conn, err := w.upgrader.Upgrade(writer, request, header)
	if err != nil {
		return err
	}

	if atomic.AddInt32(&w.connCount, 1) > int32(w.LinksLimit) {
		return ErrLimit
	}

	// HTTP, 启动一个协程去处理
	w.fd, _ = os.OpenFile("/tmp/media.webm", os.O_RDWR|os.O_TRUNC|os.O_CREATE|os.O_APPEND, 0666)
	go newConn(conn, w)
	return nil
}

func (w *WebSocketServer) ServerFile(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		return
	}

	ranges := request.Header.Get("range")
	if len(ranges) > 0 {
		parts := strings.Split(strings.ReplaceAll(ranges, "bytes=", ""), "-")
		start, _ := strconv.ParseInt(parts[0], 1, 64)
		end, _ := strconv.ParseInt(parts[1], 1, 64)
		if end == 0 {
			end = 512
		}

		writer.Header().Set("Content-Range", fmt.Sprintf("bytes %v-%v/1000000000000000000000", start, end))
		writer.Header().Set("Accept-Ranges", "bytes")
		writer.Header().Set("Content-Type", "video/webm")
		writer.Header().Set("Content-Length", fmt.Sprintf("%v", end-start+1))
		writer.WriteHeader(206)

		data := make([]byte, end-start+1)
		n, err := w.fd.ReadAt(data, start)
		log.Infof("err: %v, %v", err, n)
		writer.Write(data)
	} else {
		writer.Header().Set("Accept-Ranges", "bytes")
		writer.Header().Set("Content-Type", "video/webm")
		writer.WriteHeader(200)
		io.CopyBuffer(writer, w.fd, make([]byte, 4096))
	}
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

	go w.run()
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

func (w *WebSocketServer) defaultOnPanic(conn *Conn) {
	if r := recover(); r != nil {
		buf := make([]byte, defaultStackTraceBufLen)
		buf = buf[:runtime.Stack(buf, false)]
		stack := fmt.Sprintf("panic: %v\n%s\n", r, buf)
		log.Errorf("[OnPanic] %v %v", stack, r)
	}
}

func (w *WebSocketServer) run() {
	for {
		select {
		case conn := <-w.register:
			w.conns.Store(conn.id, conn)
		case conn := <-w.unregister:
			w.conns.LoadAndDelete(conn.id)
		case msg := <-w.broadcast:
			w.conns.Range(func(key, value interface{}) bool {
				conn := value.(*Conn)
				conn.sendChan <- message{
					data:        msg.data,
					MessageType: w.MessageType,
				}
				return true
			})
		}
	}
}

func (w *WebSocketServer) Broadcast(data []byte) error {
	w.broadcast <- &broadcastData{
		data: data,
	}
	return nil
}

func (w *WebSocketServer) GetLinkCount() int {
	return int(atomic.LoadInt32(&w.connCount))
}

func http2errno(v error) uintptr {
	if rv := reflect.ValueOf(v); rv.Kind() == reflect.Uintptr {
		return uintptr(rv.Uint())
	}
	return 0
}

func (w *WebSocketServer) IsConnClosed(err error) bool {
	if err == nil {
		return false
	}

	// WebSocket Error Code
	if websocket.IsCloseError(err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
		websocket.CloseProtocolError,
		websocket.CloseUnsupportedData,
		websocket.CloseNoStatusReceived,
		websocket.CloseAbnormalClosure,
		websocket.CloseInvalidFramePayloadData,
		websocket.ClosePolicyViolation,
		websocket.CloseMessageTooBig,
		websocket.CloseMandatoryExtension,
		websocket.CloseInternalServerErr,
		websocket.CloseServiceRestart,
		websocket.CloseTryAgainLater,
		websocket.CloseTLSHandshake) {
		return true
	}

	// TCP error
	errStr := err.Error()
	if strings.Contains(errStr, "broken pipe") ||
		strings.Contains(errStr, "reset by peer") ||
		strings.Contains(errStr, "unexpected EOF") ||
		strings.Contains(errStr, "use of closed network connection") ||
		strings.Contains(errStr, "i/o timeout") {
		return true
	}

	if runtime.GOOS == "windows" {
		codes := []uintptr{
			WSAEACCESS,
			WSAEWOULDBLOCK,
			WSAEDESTADDRREQ,
			WSAEMSGSIZE,
			WSAENETDOWN,
			WSAENETUNREACH,
			WSAENETRESET,
			WSAECONNABORTED,
			WSAECONNRESET,
			WSAESHUTDOWN,
			WSAETIMEDOUT,
			WSAEHOSTDOWN,
			WSAEHOSTUNREACH,
			WSASYSNOTREADY,
			WSAEDISCON,
		}
		if oe, ok := err.(*net.OpError); ok {
			if se, ok := oe.Err.(*os.SyscallError); ok {
				code := http2errno(se.Err)
				log.Errorf("windows syscall error: %v, %v", se.Syscall, se.Err)
				for _, val := range codes {
					if val == code {
						return true
					}
				}
			}
		}
	}

	log.Errorf("unknown: %v", err)
	return false
}

type Conn struct {
	rawConn *websocket.Conn
	server  *WebSocketServer

	id string

	writeMu sync.Mutex

	heartMu sync.Mutex
	heart   int

	sendChan chan message
	recvChan chan message

	done      chan struct{}
	closed    bool
	closeOnce sync.Once
	closeErr  error
}
type message struct {
	data        []byte
	MessageType int
}

func newConn(rawConn *websocket.Conn, server *WebSocketServer) {
	conn := &Conn{
		id:       rawConn.RemoteAddr().String(),
		rawConn:  rawConn,
		sendChan: make(chan message, 64),
		recvChan: make(chan message, 64),
		done:     make(chan struct{}),
		server:   server,
	}

	// PONG 消息处理
	rawConn.SetPongHandler(func(data string) error {
		conn.heartMu.Lock()
		conn.heart = 0
		conn.heartMu.Unlock()
		return nil
	})

	defer server.defaultOnPanic(conn)
	log.Infof("[OnConnected] %q <-> %q", conn.LocalAddr(), conn.RemoteAddr())

	server.register <- conn

	go conn.readLoop()
	go conn.writeLoop()
	go conn.handleMessage()
	select {
	case <-conn.done:
	}
}

func (c *Conn) Write(data []byte) error {
	c.sendChan <- message{
		data:        data,
		MessageType: c.server.MessageType,
	}
	return nil
}

func (c *Conn) Close() error {
	var err error
	c.closeOnce.Do(func() {
		c.server.unregister <- c
		c.closed = true
		if c.done != nil {
			close(c.done)
		}
		if c.rawConn != nil {
			err = c.rawConn.Close()
		}
		log.Infof("[OnConnected] %q <-> %q, error: %v", c.LocalAddr(), c.RemoteAddr(), c.closeErr)
		atomic.AddInt32(&c.server.connCount, -1)
	})
	return err
}

func (c *Conn) RemoteAddr() string {
	return c.rawConn.RemoteAddr().String()
}

func (c *Conn) LocalAddr() string {
	return c.rawConn.LocalAddr().String()
}

func (c *Conn) writeFatal(err error) {
	if c.closeErr == nil {
		c.closeErr = err
	}
}

func (c *Conn) rawRead() (msg message, err error) {
	msg.MessageType, msg.data, err = c.rawConn.ReadMessage()
	return msg, err
}

func (c *Conn) rawWrite(msg message) (err error) {
	c.writeMu.Lock()
	err = c.rawConn.WriteMessage(msg.MessageType, msg.data)
	c.writeMu.Unlock()

	return err
}

func (c *Conn) writeLoop() {
	defer c.server.defaultOnPanic(c)

	timeout := time.Duration(c.server.PingTimeout) * c.server.PingPeriod
	pingTicker := time.NewTicker(c.server.PingPeriod)
	heartTimer := time.NewTimer(timeout)
	defer func() {
		pingTicker.Stop()
		heartTimer.Stop()
		c.Close()
	}()

	var err error
	for {
		select {
		case <-c.done:
			return
		case msg := <-c.sendChan:
			err = c.rawWrite(msg)
		case <-pingTicker.C:
			msg := message{MessageType: websocket.PingMessage, data: []byte{}}
			c.heartMu.Lock()
			c.heart += 1
			c.heartMu.Unlock()
			err = c.rawWrite(msg)

		case <-heartTimer.C:
			heartTimer.Reset(timeout)
			c.heartMu.Lock()
			if c.heart >= c.server.PingTimeout {
				c.heartMu.Unlock()
				c.writeFatal(ErrTimeout)
				return
			}
			c.heartMu.Unlock()
		}

		if c.server.IsConnClosed(err) {
			c.writeFatal(err)
			break
		}
		if err != nil {
			continue
		}
	}
}

func (c *Conn) readLoop() {
	defer c.server.defaultOnPanic(c)
	defer c.Close()
	for {
		select {
		case <-c.done:
			return
		default:
		}

		message, err := c.rawRead()
		if c.server.IsConnClosed(err) {
			c.writeFatal(err)
			break
		}

		c.heartMu.Lock()
		c.heart = 0
		c.heartMu.Unlock()

		if err != nil {
			continue
		}
		c.recvChan <- message
	}
}

func (c *Conn) handleMessage() {
	for msg := range c.recvChan {
		log.Infof("len: %v", len(msg.data))
		c.server.fd.Write(msg.data)
	}
}
