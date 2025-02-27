# GameServer-Reborn  
Multi-User Private Server for The Simpsons™: Tapped Out Mobile Game

## Getting Started

### Prerequisites

To run this server, you'll need [Node.js](https://nodejs.org/) installed. You can download and install it by following the instructions on the official website. Additionally, you will need a patched APK, which the instructions for can be found at [TappedOutReborn/Patch-APK](https://github.com/TappedOutReborn/Patch-APK).

### Installation

Follow these steps to set up the server:

1. **Clone the Repository**  
   
   Start by cloning the project to your local machine:
   ```sh
   git clone https://github.com/TappedOutReborn/GameServer-Reborn.git
   ```

2. **Install Dependencies**
   
   Navigate into the project folder and install the required NPM packages:
   ```sh
   cd GameServer-Reborn
   npm install
   ```

3. **Download DLCs**

   The app requires "DLCs", which are game assets like characters, buildings, and quests. These must be added to the server for the game to function.

   - Create a folder called `dlc` in the server directory (if it doesn't already exist).
   - Download the DLC files using the [DLC Downloader](https://github.com/TappedOutReborn/DLC-Downloader).
   - Drag and drop the downloaded DLC files into the `dlc` folder.

4. **Configure Server Settings**
   
   Open the `config.json` file and update the ip and listenPort values to match your preferred settings:
   ```json
    "ip": "0.0.0.0",
    "listenPort": 4242
   ```

   **ip**: The IP address or domain that the game client will use to connect to your server (ensure this is accessible by the game). **Do NOT use `localhost`, `127.0.0.1` or `0.0.0.0`**
   
   **listenPort**: The port number the server will listen on.


## Running the Server

To start the server, simply run:
```sh
npm start
```

## Using your old town

### Top Contributors:

<a href="https://github.com/TappedOutReborn/GameServer-Reborn/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=TappedOutReborn/GameServer-Reborn" alt="contrib.rocks image" />
</a>

## License

Distributed under the GPLv3 License. See `LICENSE` for more information.
