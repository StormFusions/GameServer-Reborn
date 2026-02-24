# GameServer-Reborn
Multi-User Private Server for The Simpsons™: Tapped Out Mobile Game

## Features
- Working friend system and is synced with the user dashboard (/userdash)
- Backup system that takes a back up of /data folder, it takes a copy of the database and people lands
- Works well with custom DLC's like [Project Springfield](https://github.com/Project-Springfield/Project-Springfield-DLC) custom DLC that fixes a lot of bugs and brings new content

I would like to thank Project Springfield team specially Dractiums for the help with these features. Also I had help from AI modules to make this happen, this is my first major project outside my usual knowledge and was mostly a learning opertunity for myself and to make the game I once played workable again. 

## Getting Started

### Prerequisites

To run this server, you'll need [Node.js](https://nodejs.org/) installed. You can download and install it by following the instructions on the official website. Additionally, you will need a patched APK, which the instructions for can be found at [Tsto_patcher](https://github.com/al1sant0s/Tsto_patcher).

### Installation

Follow these steps to set up the server:

1. **Clone the Repository**

   Start by cloning the project to your local machine:
   ```sh
   git clone https://github.com/StormFusions/GameServer-Reborn.git
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

## Using the Dashboard(s)

- On the admin dashboard you can configure server settings and the current event, manage users, manage towns and configure the server in the UI.

- On the user dashboard you can make an email account, login and change your username and email, import and export your town and manage your friends outside of the game.

### Admin Dashboard
To access the admin dashboard you'll need the admin key. It will be automaticly generated on server startup if it's not set, and can be found in `config.json`. To use the admin dashboard simply navigate to:
```
http://yourip:yourport/dashboard
```

### User Dashboard
To use the user dashboard simply navigate to:
```
http://yourip:yourport/userdash
```

### Top Contributors:

<a href="https://github.com/TappedOutReborn/GameServer-Reborn/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=TappedOutReborn/GameServer-Reborn" alt="contrib.rocks image" />
</a>

## License

Distributed under the GPLv3 License. See `LICENSE` for more information.
