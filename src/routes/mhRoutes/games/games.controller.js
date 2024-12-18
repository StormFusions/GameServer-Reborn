import { Router, raw } from "express";

import protobuf from "protobufjs";
import fs from "fs";

import sqlite3 from "sqlite3";
import { v4 as uuidv4 } from "uuid";

import config from "../../../../config.json" with { type: "json" };

const router = Router();

router.get("/lobby/time", async (req, res, next) => {
  try {
    const xmlResponse = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
		<Time>
			<epochMilliseconds>${Math.floor(new Date().getTime())}</epochMilliseconds>
		</Time>
		`; // Send the epoch(unix timestamp) time in XML

    res.type("application/xml"); // Make sure the client knows it's XML
    res.send(xmlResponse);
  } catch (error) {
    next(error);
  }
});

router.get(
  "/bg_gameserver_plugin/protoClientConfig/",
  async (req, res, next) => {
    try {
      const root = await protobuf.load("TappedOut.proto");
      const ClientConfigResponse = root.lookupType("Data.ClientConfigResponse");

      const clientConfigJSON = JSON.parse(
        fs.readFileSync("configs/ClientConfig.json"),
      );
      let message = ClientConfigResponse.create(clientConfigJSON);

      res.type("application/x-protobuf"); // Make sure the client knows it's protobuf
      res.send(ClientConfigResponse.encode(message).finish());
    } catch (error) {
      next(error);
    }
  },
);

// -- Land -- \\
router.post(
  "/bg_gameserver_plugin/protoWholeLandToken/:mayhemId",
  async (req, res, next) => {
    const QUERY = `
        SELECT UserAccessToken, WholeLandToken
        FROM userData
        WHERE MayhemId = ?`;

    const UPDATE_QUERY = `
        UPDATE userData
        SET WholeLandToken = ?
        WHERE MayhemId = ?`;

    try {
      const mayhemId = req.params.mayhemId;
      const force = req.query.force;

      const reqToken =
        req.headers["nucleus_token"] || req.headers["mh_auth_params"];
      if (!reqToken) {
        res
          .type("application/xml")
          .status(400)
          .send(
            `<?xml version="1.0" encoding="UTF-8"?>
				<error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
          );
        return;
      }

      const db = new sqlite3.Database(
        config.dataDirectory + "/users.db",
        sqlite3.OPEN_READWRITE,
        (error) => {
          if (error) {
            console.error("Error opening database:", error.message);
            return;
          }
        },
      );

      await db.get(QUERY, [mayhemId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          db.close();
          return;
        }

        if (!row) {
          res
            .type("application/xml")
            .status(404)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="404" type="NOT_FOUND" field="mayhemId"/>`,
            );
          return;
        }

        let userData = row;

        if (!reqToken == userData.UserAccessToken) {
          res
            .type("application/xml")
            .status(400)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="BAD_REQUEST" field="Invalid AcessToken for specified MayhemId"/>`,
            );
          return;
        }

        if (!userData.WholeLandToken && (!force || force != "1")) {
          res
            .type("application/xml")
            .status(400)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="RESOURCE_ALREADY_EXISTS"/>`,
            );
          return;
        }

        const newWholeLandToken = uuidv4();
        db.run(
          UPDATE_QUERY,
          [newWholeLandToken, mayhemId],
          async function (error) {
            if (error) {
              console.error("Error updating WholeLandToken:", error.message);
              res
                .type("application/xml")
                .status(500)
                .send(
                  `<?xml version="1.0" encoding="UTF-8"?>
						<error code="500" type="INTERNAL_SERVER_ERROR"/>`,
                );
              return;
            }

            const root = await protobuf.load("TappedOut.proto");
            const WholeLandTokenResponse = root.lookupType(
              "Data.WholeLandTokenResponse",
            );

            let message = WholeLandTokenResponse.create({
              token: newWholeLandToken,
              conflict: "0",
            });
            res.type("application/x-protobuf"); // Make sure the client knows it's protobuf
            res.send(WholeLandTokenResponse.encode(message).finish());
          },
        );

        db.close((error) => {
          if (error) {
            console.error("Error closing database:", error.message);
            return;
          }
        });
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/bg_gameserver_plugin/checkToken/:mayhemId/protoWholeLandToken/",
  async (req, res, next) => {
    const QUERY = `
        SELECT UserAccessToken, WholeLandToken
        FROM userData
        WHERE MayhemId = ?`;

    console.log(config.dataDirectory + "/users.db");

    try {
      const mayhemId = req.params.mayhemId;

      const reqToken =
        req.headers["nucleus_token"] || req.headers["mh_auth_params"];
      if (!reqToken) {
        res
          .type("application/xml")
          .status(400)
          .send(
            `<?xml version="1.0" encoding="UTF-8"?>
				<error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
          );
        return;
      }

      const db = new sqlite3.Database(
        config.dataDirectory + "/users.db",
        sqlite3.OPEN_READWRITE,
        (error) => {
          if (error) {
            console.error("Error opening database:", error.message);
            return;
          }
        },
      );

      await db.get(QUERY, [mayhemId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          db.close();
          return;
        }

        if (!row) {
          res
            .type("application/xml")
            .status(404)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="404" type="NOT_FOUND" field="mayhemId"/>`,
            );
          return;
        }

        let userData = row;

        if (!reqToken == userData.UserAccessToken) {
          res
            .type("application/xml")
            .status(400)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="BAD_REQUEST" field="Invalid AcessToken for specified MayhemId"/>`,
            );
          return;
        }

        const root = await protobuf.load("TappedOut.proto");
        const WholeLandTokenResponse = root.lookupType(
          "Data.WholeLandTokenResponse",
        );

        let message = WholeLandTokenResponse.create({
          token: userData.WholeLandToken,
          conflict: "0",
        });
        res.type("application/x-protobuf"); // Make sure the client knows it's protobuf
        res.send(WholeLandTokenResponse.encode(message).finish());

        db.close((error) => {
          if (error) {
            console.error("Error closing database:", error.message);
            return;
          }
        });
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/bg_gameserver_plugin/deleteToken/:mayhemId/protoWholeLandToken/",
  raw({
    type: "application/x-protobuf",
  }) /* Needed so express allows us to read the protobuf body */,
  async (req, res, next) => {
    const QUERY = `
        SELECT UserAccessToken, WholeLandToken
        FROM userData
        WHERE MayhemId = ?`;

    const UPDATE_QUERY = `
        UPDATE userData
        SET WholeLandToken = ?
        WHERE MayhemId = ?`;

    try {
      const mayhemId = req.params.mayhemId;

      const root = await protobuf.load("TappedOut.proto");
      const DeleteTokenRequest = root.lookupType("Data.DeleteTokenRequest");

      const decodedBody = DeleteTokenRequest.decode(req.body);

      const reqToken =
        req.headers["nucleus_token"] || req.headers["mh_auth_params"];
      if (!reqToken) {
        res
          .type("application/xml")
          .status(400)
          .send(
            `<?xml version="1.0" encoding="UTF-8"?>
				<error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
          );
        return;
      }

      const db = new sqlite3.Database(
        config.dataDirectory + "/users.db",
        sqlite3.OPEN_READWRITE,
        (error) => {
          if (error) {
            console.error("Error opening database:", error.message);
            return;
          }
        },
      );

      await db.get(QUERY, [mayhemId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          db.close();
          return;
        }

        if (!row) {
          res
            .type("application/xml")
            .status(404)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="404" type="NOT_FOUND" field="mayhemId"/>`,
            );
          return;
        }

        let userData = row;

        if (!reqToken == userData.UserAccessToken) {
          res
            .type("application/xml")
            .status(400)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="BAD_REQUEST" field="Invalid AcessToken for specified MayhemId"/>`,
            );
          return;
        }

        if (!decodedBody.token == userData.WholeLandToken) {
          // Request land update token and saved land update token are not the same
          root = await protobuf.load("TappedOut.proto");
          const DeleteTokenResponse = root.lookupType(
            "Data.DeleteTokenResponse",
          );

          let message = DeleteTokenResponse.create({ result: "0" });
          res.type("application/x-protobuf"); // Make sure the client knows it's protobuf
          res.send(DeleteTokenResponse.encode(message).finish());
          return;
        }

        db.run(UPDATE_QUERY, ["", mayhemId], async function (error) {
          if (error) {
            console.error("Error updating WholeLandToken:", error.message);
            res
              .type("application/xml")
              .status(500)
              .send(
                `<?xml version="1.0" encoding="UTF-8"?>
						<error code="500" type="INTERNAL_SERVER_ERROR"/>`,
              );
            return;
          }

          const root = await protobuf.load("TappedOut.proto");
          const DeleteTokenResponse = root.lookupType(
            "Data.DeleteTokenResponse",
          );

          let message = DeleteTokenResponse.create({ result: "1" });
          res.type("application/x-protobuf"); // Make sure the client knows it's protobuf
          res.send(DeleteTokenResponse.encode(message).finish());
        });

        db.close((error) => {
          if (error) {
            console.error("Error closing database:", error.message);
            return;
          }
        });
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/bg_gameserver_plugin/protoland/:landId",
  async (req, res, next) => {
    const QUERY = `
        	SELECT UserAccessToken, WholeLandToken, LandSavePath
        	FROM userData
        	WHERE MayhemId = ?`;

    try {
      const landId = req.params.landId;
      const wholeLandToken = req.headers["land-update-token"];

      const reqToken =
        req.headers["nucleus_token"] || req.headers["mh_auth_params"];
      if (!reqToken) {
        res
          .type("application/xml")
          .status(400)
          .send(
            `<?xml version="1.0" encoding="UTF-8"?>
				<error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
          );
        return;
      }

      const db = new sqlite3.Database(
        config.dataDirectory + "/users.db",
        sqlite3.OPEN_READONLY,
        (error) => {
          if (error) {
            console.error("Error opening database:", error.message);
            return;
          }
        },
      );

      await db.get(QUERY, [landId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          db.close();
          return;
        }

        if (!row) {
          res
            .type("application/xml")
            .status(404)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="404" type="NOT_FOUND" field="mayhemId"/>`,
            );
          return;
        }

        let userData = row;

        if (!reqToken == userData.UserAccessToken) {
          res
            .type("application/xml")
            .status(400)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="BAD_REQUEST" field="Invalid AcessToken for specified MayhemId"/>`,
            );
          return;
        }

        const savePath = userData.LandSavePath;
        if (
          !savePath ||
          savePath == "" ||
          !fs.existsSync(savePath) ||
          fs.statSync(savePath).size == 0
        ) {
          // If the value is empty or null, or if the file doesn't exist or is empty
          res
            .type("application/xml")
            .status(404)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="404" type="NO_SUCH_RESOURCE" field="LAND_NOT_FOUND"/>`,
            );
          return;
        }
        const serializedSaveData = fs.readFileSync(savePath);

        res.type("application/x-protobuf"); // Make sure the client knows it's protobuf
        res.send(serializedSaveData);

        db.close((error) => {
          if (error) {
            console.error("Error closing database:", error.message);
            return;
          }
        });
      });
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  "/bg_gameserver_plugin/protoland/:landId",
  raw({
    type: "application/x-protobuf",
  }) /* Needed so express allows us to read the protobuf body */,
  async (req, res, next) => {
    const QUERY = `
        	SELECT UserAccessToken, WholeLandToken, LandSavePath
        	FROM userData
        	WHERE MayhemId = ?`;

    const UPDATE_QUERY = `
		UPDATE userData
		SET LandSavePath = ?
		WHERE MayhemId = ?`;
    try {
      const landId = req.params.landId;
      const wholeLandToken = req.headers["land-update-token"];

      const reqToken =
        req.headers["nucleus_token"] || req.headers["mh_auth_params"];
      if (!reqToken) {
        res
          .type("application/xml")
          .status(400)
          .send(
            `<?xml version="1.0" encoding="UTF-8"?>
				<error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
          );
        return;
      }

      const db = new sqlite3.Database(
        config.dataDirectory + "/users.db",
        sqlite3.OPEN_READONLY,
        (error) => {
          if (error) {
            console.error("Error opening database:", error.message);
            return;
          }
        },
      );

      await db.get(QUERY, [landId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          db.close();
          return;
        }

        if (!row) {
          res
            .type("application/xml")
            .status(404)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="404" type="NOT_FOUND" field="mayhemId"/>`,
            );
          return;
        }

        let userData = row;

        if (!reqToken == userData.UserAccessToken) {
          res
            .type("application/xml")
            .status(400)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="BAD_REQUEST" field="Invalid AcessToken for specified MayhemId"/>`,
            );
          return;
        }

        if (!wholeLandToken == userData.WholeLandToken) {
          res
            .type("application/xml")
            .status(400)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="BAD_REQUEST" field="Invalid WholeLandToken for specified MayhemId"/>`,
            );
          return;
        }

        let savePath = userData.LandSavePath;
        if (!savePath || savePath == "") {
          // Set to config.dataDirectory/MayhemId/MayhemId.land
          savePath = `${config.dataDirectory}/${landId}/${landId}.land`;
          db.run(UPDATE_QUERY, [savePath, landId], async function (error) {
            if (error) {
              console.error("Error updating WholeLandToken:", error.message);
              res
                .type("application/xml")
                .status(500)
                .send(
                  `<?xml version="1.0" encoding="UTF-8"?>
							<error code="500" type="INTERNAL_SERVER_ERROR"/>`,
                );
              return;
            }
          });
        }

        // Override file with req.body
        fs.writeFileSync(savePath, req.body, { flag: "w+" }, (err) => {
          console.error(err);
        });

        // If sql value is empty or null, set it to what it should be based on MayhemId
        // If the file doesn't exist make it
        // Override with whatever the req.body is

        res.type("application/x-protobuf"); // Make sure the client knows it's protobuf
        res.send(req.body); // Send the request body back, for some reason. Blame EA.

        db.close((error) => {
          if (error) {
            console.error("Error closing database:", error.message);
            return;
          }
        });
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/bg_gameserver_plugin/protoland/:landId",
  raw({
    type: "application/x-protobuf",
  }) /* Needed so express allows us to read the protobuf body */,
  async (req, res, next) => {
    const QUERY = `
        	SELECT UserAccessToken, WholeLandToken, LandSavePath
        	FROM userData
        	WHERE MayhemId = ?`;

    const UPDATE_QUERY = `
		UPDATE userData
		SET LandSavePath = ?
		WHERE MayhemId = ?`;
    try {
      const landId = req.params.landId;
      const wholeLandToken = req.headers["land-update-token"];

      const reqToken =
        req.headers["nucleus_token"] || req.headers["mh_auth_params"];
      if (!reqToken) {
        res
          .type("application/xml")
          .status(400)
          .send(
            `<?xml version="1.0" encoding="UTF-8"?>
				<error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
          );
        return;
      }

      const db = new sqlite3.Database(
        config.dataDirectory + "/users.db",
        sqlite3.OPEN_READONLY,
        (error) => {
          if (error) {
            console.error("Error opening database:", error.message);
            return;
          }
        },
      );

      await db.get(QUERY, [landId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          db.close();
          return;
        }

        if (!row) {
          res
            .type("application/xml")
            .status(404)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="404" type="NOT_FOUND" field="mayhemId"/>`,
            );
          return;
        }

        let userData = row;

        if (!reqToken == userData.UserAccessToken) {
          res
            .type("application/xml")
            .status(400)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="BAD_REQUEST" field="Invalid AcessToken for specified MayhemId"/>`,
            );
          return;
        }

        if (!wholeLandToken == userData.WholeLandToken) {
          res
            .type("application/xml")
            .status(400)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="BAD_REQUEST" field="Invalid WholeLandToken for specified MayhemId"/>`,
            );
          return;
        }

        let savePath = userData.LandSavePath;
        if (
          !savePath ||
          savePath == "" ||
          !fs.existsSync(savePath) ||
          fs.statSync(savePath).size == 0
        ) {
          // If the value is empty or null, or if the file doesn't exist or is empty
          res
            .type("application/xml")
            .status(404)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="404" type="NO_SUCH_RESOURCE" field="LAND_NOT_FOUND"/>`,
            );
          return;
        }

        // Override file with req.body
        fs.writeFileSync(savePath, req.body, { flag: "w+" }, (err) => {
          console.error(err);
        });

        res.type("application/xml"); // Make sure the client knows it's xml
        res.send(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
				<WholeLandUpdateResponse/>`,
        );

        db.close((error) => {
          if (error) {
            console.error("Error closing database:", error.message);
            return;
          }
        });
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/bg_gameserver_plugin/protocurrency/:landId",
  async (req, res, next) => {
    const QUERY = `
        	SELECT UserAccessToken, WholeLandToken
        	FROM userData
        	WHERE MayhemId = ?`;

    try {
      const landId = req.params.landId;
      const wholeLandToken = req.headers["land-update-token"];

      const reqToken =
        req.headers["nucleus_token"] || req.headers["mh_auth_params"];
      if (!reqToken) {
        res
          .type("application/xml")
          .status(400)
          .send(
            `<?xml version="1.0" encoding="UTF-8"?>
				<error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
          );
        return;
      }

      const db = new sqlite3.Database(
        config.dataDirectory + "/users.db",
        sqlite3.OPEN_READONLY,
        (error) => {
          if (error) {
            console.error("Error opening database:", error.message);
            return;
          }
        },
      );

      await db.get(QUERY, [landId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          db.close();
          return;
        }

        if (!row) {
          res
            .type("application/xml")
            .status(404)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="404" type="NOT_FOUND" field="mayhemId"/>`,
            );
          return;
        }

        let userData = row;

        if (!reqToken == userData.UserAccessToken) {
          res
            .type("application/xml")
            .status(400)
            .send(
              `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="BAD_REQUEST" field="Invalid AcessToken for specified MayhemId"/>`,
            );
          return;
        }

        const root = await protobuf.load("TappedOut.proto");
        const CurrencyData = root.lookupType("Data.CurrencyData");

        let message = CurrencyData.create({
          id: landId,
          vcTotalPurchased: "0",
          vcTotalAwarded: "0",
          vcBalance: "0",
        });
        res.type("application/x-protobuf"); // Make sure the client knows it's protobuf
        res.send(CurrencyData.encode(message).finish());

        db.close((error) => {
          if (error) {
            console.error("Error closing database:", error.message);
            return;
          }
        });
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/bg_gameserver_plugin/extraLandUpdate/:landId/protoland/",
  async (req, res, next) => {
    try {
      res.type("application/x-protobuf").status(200).send(""); // Ignore for now as i don't know what it's for
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/bg_gameserver_plugin/protoland/:landId",
  async (req, res, next) => {
    try {
      res.status(200);
    } catch (error) {
      next(error);
    }
  },
);

// -- Friends -- \\

router.post(
  "/bg_gameserver_plugin/friendData/:something",
  async (req, res, next) => {
    try {
      res.status(200).send("Not yet implemented"); // Not yet implemented, but let the client know we received it
    } catch (error) {
      next(error);
    }
  },
);

// -- Tracking -- \\
// Ignored, but the game won't function without it \\

router.post("/bg_gameserver_plugin/trackinglog", async (req, res, next) => {
  try {
    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
		<Resources>
  			<URI>OK</URI>
		</Resources>`;

    res.type("application/xml"); // Make sure the client knows it's XML
    res.send(xmlResponse); // Ignore the request, but let the client know we received it
  } catch (error) {
    next(error);
  }
});

router.post("/bg_gameserver_plugin/trackingmetrics", async (req, res, next) => {
  try {
    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
		<Resources>
  			<URI>OK</URI>
		</Resources>`;

    res.type("application/xml"); // Make sure the client knows it's XML
    res.send(xmlResponse); // Ignore the request, but let the client know we received it
  } catch (error) {
    next(error);
  }
});

export default router;
