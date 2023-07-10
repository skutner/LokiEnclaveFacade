const logger = $$.getLogger("LightDBServer", "LokiEnclaveFacade");

process.on('uncaughtException', err => {
    logger.critical('There was an uncaught error', err, err.message, err.stack);
});

process.on('SIGTERM', (signal)=>{
    process.shuttingDown = true;
    logger.info('Received signal:', signal, ". Activating the gracefulTerminationWatcher.");
});

function LightDBServer({rootFolder, port, host}, callback) {
    const apihubModule = require("apihub");
    const LokiEnclaveFacade = require("./LokiEnclaveFacade");
    const httpWrapper = apihubModule.getHttpWrapper();
    const Server = httpWrapper.Server;
    const CHECK_FOR_RESTART_COMMAND_FILE_INTERVAL = 500;
    host = host || "localhost";
    port = port || 8081;

    const server = new Server();
    let dynamicPort;
    const path = require("path");
    let storage = path.join(rootFolder, "external-volume", "light-db-server-root", "lightDB");
    const fs = require("fs");
    try {
        fs.accessSync(storage);
    } catch (err) {
        fs.mkdirSync(path.dirname(storage), {recursive: true});
    }
    const lokiEnclaveFacade = new LokiEnclaveFacade(storage);

    let accessControlAllowHeaders = new Set();
    accessControlAllowHeaders.add("Content-Type");
    accessControlAllowHeaders.add("Content-Length");
    accessControlAllowHeaders.add("X-Content-Length");
    accessControlAllowHeaders.add("Access-Control-Allow-Origin");
    accessControlAllowHeaders.add("User-Agent");
    accessControlAllowHeaders.add("Authorization");

    let listenCallback = (err) => {
        if (err) {
            logger.error(err);
            if (!dynamicPort && callback) {
                return OpenDSUSafeCallback(callback)(createOpenDSUErrorWrapper(`Failed to listen on port <${port}>`, err));
            }
            if(dynamicPort && error.code === 'EADDRINUSE'){
                function getRandomPort() {
                    const min = 9000;
                    const max = 65535;
                    return Math.floor(Math.random() * (max - min) + min);
                }
                port = getRandomPort();
                if(Number.isInteger(dynamicPort)){
                    dynamicPort -= 1;
                }
                setTimeout(bootup, CHECK_FOR_RESTART_COMMAND_FILE_INTERVAL);
            }
        }
    };

    function bindFinished(err) {
        if (err) {
            logger.error(err);
            if (callback) {
                return OpenDSUSafeCallback(callback)(createOpenDSUErrorWrapper(`Failed to bind on port <${port}>`, err));
            }
            return;
        }

        process.env.LIGHT_DB_SERVER_ADDRESS = `http://${host}:${port}`;
        registerEndpoints(callback);
    }

    function bootup(){
        logger.debug(`Trying to listen on port ${port}`);
        server.listen(port, host, listenCallback);
    }

    bootup();

    server.on('listening', bindFinished);
    server.on('error', listenCallback);

    function registerEndpoints() {
        server.getAccessControlAllowHeadersAsString = function(){
            let headers = "";
            let notFirst = false;
            for(let header of accessControlAllowHeaders){
                if(notFirst){
                    headers += ", ";
                }
                notFirst = true;
                headers += header;
            }
            return headers;
        }

        server.use(function (req, res, next) {
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin || req.headers.host || "*");
            res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', server.getAccessControlAllowHeadersAsString());
            res.setHeader('Access-Control-Allow-Credentials', true);
            next();
        });

        server.use("/executeCommand", httpWrapper.httpUtils.bodyParser);

        server.put("/executeCommand", function (req, res) {
            const body = req.body;
            const command = body.command;
            const args = body.args;


            if(typeof command !== "string"){
                logger.error("Invalid command", command);
                return res.send(400, "Invalid command");
            }

            if(!Array.isArray(args)){
                logger.error("Invalid args", args);
                return res.send(400, "Invalid args");
            }

            const callback = (err, result) => {
                if(err){
                    res.statusCode = 500;
                    logger.error(`Error while executing command ${command}`, err);
                    res.write(`Error while executing command ${command}: ${err.message}`);
                    return res.end();
                }

                res.statusCode = 200;
                res.write(JSON.stringify(result));
                res.end();
            }

            args.push(callback);
            lokiEnclaveFacade[command](...args);
        })
    }
}

module.exports = LightDBServer;