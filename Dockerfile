# Use official Node.js 18 slim image
FROM node:18-slim

# Install git to clone the repository
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Set the working directory and permissions
WORKDIR /home/node/app
RUN chown -R node:node /home/node/app

# Use the existing 'node' user (UID 1000)
USER node
ENV HOME=/home/node \
    PATH=/home/node/.local/bin:$PATH

# The user requested to clone the repo inside the container
RUN git clone https://github.com/AlexaInc/wordlesolver.git .

# Install dependencies 
RUN npm install

# Expose the standard Hugging Face Spaces port
EXPOSE 7860

# Command to start both the web server and the bot
# Note: Ensure you have set BOT_TOKEN in Hugging Face Secrets!
CMD ["npm", "start"]
