package ws

import (
	"fmt"
	"net"
	"os"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ion-log"
)

const (
	defaultStackTraceBufLen = 2048
)

// https://docs.microsoft.com/en-us/windows/win32/winsock/windows-sockets-error-codes-2
// noinspection ALL
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

func http2errno(v error) uintptr {
	if rv := reflect.ValueOf(v); rv.Kind() == reflect.Uintptr {
		return uintptr(rv.Uint())
	}
	return 0
}

func IsClosed(err error) bool {
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

func defaultOnPanic(conn *Conn) {
	if r := recover(); r != nil {
		buf := make([]byte, defaultStackTraceBufLen)
		buf = buf[:runtime.Stack(buf, false)]
		stack := fmt.Sprintf("panic: %v\n%s\n", r, buf)
		log.Errorf("[OnPanic] %v %v", stack, r)
	}
}

type Conn struct {
	PingPeriod   time.Duration
	MaxPing      uint
	MessageType  MessageType
	onData       func(message Message)
	onConnect    func(conn *Conn)
	onDisconnect func(conn *Conn, err error)

	raw *websocket.Conn

	id string

	writeMu sync.Mutex

	heartMu sync.Mutex
	heart   int

	sendChan chan Message
	recvChan chan Message

	done      chan struct{}
	closed    bool
	closeOnce sync.Once
	closeErr  error
}

type Message struct {
	Data        []byte
	MessageType int
}

func newConn(conn *websocket.Conn, pingPeriod time.Duration, maxPing uint, msgType MessageType) *Conn {
	c := &Conn{
		raw:         conn,
		id:          conn.RemoteAddr().String(),
		sendChan:    make(chan Message, 64),
		recvChan:    make(chan Message, 64),
		done:        make(chan struct{}),
		PingPeriod:  pingPeriod,
		MaxPing:     maxPing,
		MessageType: msgType,
		onData: func(message Message) {
		},
		onConnect: func(conn *Conn) {
			log.Infof("[OnConnect] %q<->%q connect", conn.LocalAddr(), conn.RemoteAddr())
		},
		onDisconnect: func(conn *Conn, err error) {
			log.Infof("[OnConnected]  %q<->%q disconnect, err:%v", conn.LocalAddr(), conn.RemoteAddr(), err)
		},
	}

	// PONG 消息处理
	conn.SetPongHandler(func(data string) error {
		c.heartMu.Lock()
		c.heart = 0
		c.heartMu.Unlock()
		return nil
	})

	defer defaultOnPanic(c)
	c.onConnect(c)

	go func() {
		go c.readLoop()
		go c.writeLoop()
		go c.handleMessage()
		select {
		case <-c.done:
		}
	}()

	return c
}

func (c *Conn) OnData(f func(message Message)) {
	c.onData = f
}

func (c *Conn) OnConnect(f func(conn *Conn)) {
	c.onConnect = f
}

func (c *Conn) OnDisconnect(f func(conn *Conn, err error)) {
	c.onDisconnect = f
}

func (c *Conn) Write(data []byte) error {
	c.sendChan <- Message{
		Data:        data,
		MessageType: c.MessageType,
	}
	return nil
}

func (c *Conn) Close() error {
	var err error
	c.closeOnce.Do(func() {
		c.closed = true
		if c.done != nil {
			close(c.done)
		}
		if c.raw != nil {
			err = c.raw.Close()
		}
		c.onDisconnect(c, c.closeErr)
	})
	return err
}

func (c *Conn) RemoteAddr() string {
	return c.raw.RemoteAddr().String()
}

func (c *Conn) LocalAddr() string {
	return c.raw.LocalAddr().String()
}

func (c *Conn) writeFatal(err error) {
	if c.closeErr == nil {
		c.closeErr = err
	}
}

func (c *Conn) rawRead() (msg Message, err error) {
	msg.MessageType, msg.Data, err = c.raw.ReadMessage()
	return msg, err
}

func (c *Conn) rawWrite(msg Message) (err error) {
	c.writeMu.Lock()
	err = c.raw.WriteMessage(msg.MessageType, msg.Data)
	c.writeMu.Unlock()

	return err
}

func (c *Conn) writeLoop() {
	defer defaultOnPanic(c)

	timeout := time.Duration(c.MaxPing) * time.Duration(c.PingPeriod)
	pingTicker := time.NewTicker(c.PingPeriod)
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
			msg := Message{MessageType: websocket.PingMessage, Data: []byte{}}
			c.heartMu.Lock()
			c.heart += 1
			c.heartMu.Unlock()
			err = c.rawWrite(msg)

		case <-heartTimer.C:
			heartTimer.Reset(timeout)
			c.heartMu.Lock()
			if c.heart >= int(c.MaxPing) {
				c.heartMu.Unlock()
				c.writeFatal(ErrTimeout)
				return
			}
			c.heartMu.Unlock()
		}

		if IsClosed(err) {
			c.writeFatal(err)
			break
		}
		if err != nil {
			continue
		}
	}
}

func (c *Conn) readLoop() {
	defer defaultOnPanic(c)
	defer c.Close()
	for {
		select {
		case <-c.done:
			return
		default:
		}

		message, err := c.rawRead()
		if IsClosed(err) {
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
		c.onData(msg)
	}
}
