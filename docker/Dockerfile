# Use the base image with Node.js
FROM node:18.20.8-alpine3.21
RUN apk add --update --no-cache openssh-client git
RUN mkdir -p -m 0600 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts

ARG RESET_DB_ARG=false
ENV RESET_DB=$RESET_DB_ARG

# Copy the current directory into the Docker image
COPY . /challenge-api

# Set working directory for future use
WORKDIR /challenge-api

# Install the dependencies from package.json
RUN npm i -g pnpm
RUN --mount=type=ssh pnpm install

RUN chmod +x appStartUp.sh
CMD ./appStartUp.sh
