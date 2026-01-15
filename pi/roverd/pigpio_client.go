//go:build !dummy

package roverd

import (
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"
)

const (
	defaultPigpioAddr = "localhost:8888"
	piCmdSetMode      = 0
	piCmdWrite        = 4
	piCmdServo        = 8
	piCmdWaveClear    = 27
	piCmdWaveAdd      = 28
	piCmdWaveTxBusy   = 32
	piCmdWaveCreate   = 49
	piCmdWaveDelete   = 50
	piCmdWaveTxSend   = 51
	piOutput          = 1

	pigpioConnectRetries = 20
	pigpioConnectDelay   = 250 * time.Millisecond
)

type pigpioClient struct {
	conn net.Conn
	mu   sync.Mutex
}

func newPigpioClient(addr string) (*pigpioClient, error) {
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return nil, err
	}
	if tcpConn, ok := conn.(*net.TCPConn); ok {
		_ = tcpConn.SetNoDelay(true)
	}
	return &pigpioClient{conn: conn}, nil
}

func connectPigpioWithRetry(addr string, logger *log.Logger) (*pigpioClient, error) {
	var lastErr error
	for attempt := 1; attempt <= pigpioConnectRetries; attempt++ {
		client, err := newPigpioClient(addr)
		if err == nil {
			return client, nil
		}
		lastErr = err
		if attempt == 1 || attempt%4 == 0 {
			logger.Printf("pigpio connect attempt %d/%d failed: %v", attempt, pigpioConnectRetries, err)
		}
		time.Sleep(pigpioConnectDelay)
	}
	return nil, lastErr
}

func (c *pigpioClient) Close() error {
	if c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

func (c *pigpioClient) command(cmd, p1, p2, p3 uint32, ext []byte) (int32, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	var buf [16]byte
	binary.LittleEndian.PutUint32(buf[0:], cmd)
	binary.LittleEndian.PutUint32(buf[4:], p1)
	binary.LittleEndian.PutUint32(buf[8:], p2)
	binary.LittleEndian.PutUint32(buf[12:], p3)

	if _, err := c.conn.Write(buf[:]); err != nil {
		return -1, err
	}
	if len(ext) > 0 {
		if _, err := c.conn.Write(ext); err != nil {
			return -1, err
		}
	}
	if _, err := io.ReadFull(c.conn, buf[:]); err != nil {
		return -1, err
	}
	res := int32(binary.LittleEndian.Uint32(buf[12:]))
	return res, nil
}

func ensurePigpioAddr(addr string) string {
	if addr != "" {
		return addr
	}
	return defaultPigpioAddr
}

func setPigpioMode(client *pigpioClient, pin int, mode uint32) error {
	res, err := client.command(piCmdSetMode, uint32(pin), mode, 0, nil)
	if err != nil {
		return fmt.Errorf("pigpio set mode: %w", err)
	}
	if res < 0 {
		return fmt.Errorf("pigpio set mode: %d", res)
	}
	return nil
}

func writePigpio(client *pigpioClient, pin int, level uint32) error {
	res, err := client.command(piCmdWrite, uint32(pin), level, 0, nil)
	if err != nil {
		return fmt.Errorf("pigpio write: %w", err)
	}
	if res < 0 {
		return fmt.Errorf("pigpio write: %d", res)
	}
	return nil
}

func setPigpioServo(client *pigpioClient, pin int, pulseWidth int) error {
	res, err := client.command(piCmdServo, uint32(pin), uint32(pulseWidth), 0, nil)
	if err != nil {
		return fmt.Errorf("pigpio servo: %w", err)
	}
	if res < 0 {
		return fmt.Errorf("pigpio servo: %d", res)
	}
	return nil
}
