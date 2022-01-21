import * as http from 'http'
import { getConfig, subscribeConfig } from './config'
import open from 'open'
import { app } from './index'
import * as https from 'https'
import { watchLoad } from './watchLoad'
import { networkInterfaces } from 'os';

let firstTime = true
let httpSrv: http.Server
let httpsSrv: http.Server
let cert:string, key: string

subscribeConfig({ k:'port', defaultValue: 80 }, async (port: number) => {
    await stopServer(httpSrv)
    httpSrv = http.createServer(app.callback());
    await startServer(httpSrv, port ?? 80)
})


subscribeConfig({ k:'cert' }, async (v: string) => {
    await stopServer(httpsSrv)
    cert = v
    if (!cert) return
    if (cert.includes('\n'))
        return considerHttps()
    // it's a path
    watchLoad(cert, data => {
        cert = data
        considerHttps()
    })
    cert = ''
})

subscribeConfig({ k:'private_key' }, async (v: string) => {
    await stopServer(httpsSrv)
    key = v
    if (!key) return
    if (key.includes('\n'))
        return considerHttps()
    // it's a path
    watchLoad(key, data => {
        key = data
        considerHttps()
    })
    key = ''
})

const CFG_HTTPS_PORT = 'https_port'
subscribeConfig({ k:CFG_HTTPS_PORT, defaultValue: 443 }, considerHttps)

async function considerHttps() {
    if (!cert || !key)
        return stopServer(httpsSrv)
    httpsSrv = https.createServer({ key, cert }, app.callback());
    return await startServer(httpsSrv, getConfig('https_port'), 's')
}

function startServer(srv: http.Server, port: number, secure:string='') {
    return new Promise((resolve, reject) => {
        try {
            if (port < 0)
                return resolve(null)
            srv.listen(port, () => {
                const proto = 'http' + secure
                const ad = srv.address()
                if (!ad)
                    return reject('no address')
                if (typeof ad === 'string')
                    return reject('type of socket not supported')
                port = ad.port
                console.log(proto, `serving on port`, port)

                const ignore = /^(lo|.*loopback.*|virtualbox.*|.*\(wsl\).*)$/i // avoid giving too much information
                for (const [name, nets] of Object.entries(networkInterfaces()))
                    if (nets && !ignore.test(name)) {
                        console.log('network', name)
                        for (const net of nets) {
                            if (net.internal) continue
                            const appendPort = port === (secure ? 443 : 80) ? '' : ':' + port
                            console.log('-', proto + '://' + net.address + appendPort)
                        }
                    }

                if (firstTime && getConfig('open_browser_at_start') !== false) {
                    open(proto + '://localhost:' + port).then()
                    firstTime = false
                }
                resolve(null)
            }).on('error', e => {
                const { code } = e as any
                console.error(code === 'EADDRINUSE' ? `couldn't listen on busy port ${port}` : e)
                reject(e)
            })
        }
        catch(e) {
            console.error("couldn't listen on port", port, String(e))
            reject(e)
        }
    })
}

function stopServer(srv: http.Server) {
    return new Promise(resolve => {
        if (!srv?.listening)
            return resolve(null)
        srv.close(err => {
            if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING')
                console.debug('failed to stop server', String(err))
            resolve(err)
        })
    })
}